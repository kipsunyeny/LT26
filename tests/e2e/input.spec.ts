// Input E2E: real touch swipes (CDP touch events → Pointer Events), mouse swipes and the dial.
// Assertions are on the KickIntent the UI emits (window.__lt26.intents), so they hold with the
// stub sim and with the real sim flying the ball.
import { expect, test, type CDPSession, type Page } from '@playwright/test';

interface Intent {
  kind: 'strike' | 'push';
  scheme: 'swipe' | 'dial';
  aim: { kind: 'angles'; azimuth: number; elevation: number } | { kind: 'target'; x: number; y: number };
  power: number;
  sideSpin: number;
  topSpin: number;
  disguise?: boolean;
  atMs: number;
}

// Headless WebGL (SwiftShader) can run at well under 1 fps on the high-DPR tablet profile, and
// every CDP touch event waits for a frame: give these tests triple time.
test.beforeEach(() => test.slow());

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

async function open(page: Page, scheme: 'swipe' | 'dial', mode: 'freeKick' | 'penalty' | 'longShot'): Promise<void> {
  await page.addInitScript((s) => {
    localStorage.setItem(
      'lt26.settings.v1',
      JSON.stringify({ controlScheme: s, altitude: 'nairobi', sound: false, footed: 'right' }),
    );
  }, scheme);
  await page.goto('./');
  await page.getByTestId(`btn-mode-${mode}`).click();
  await expect(page.getByTestId('hud')).toBeVisible();
  await expect(page.getByTestId('input-layer')).toHaveAttribute('data-scheme', scheme);
}

/**
 * The ball's screen position (exposed by the HUD). The 3D camera settles over the first frames
 * after entering a mode, so wait until two reads a second apart agree and are on screen.
 */
async function ball(page: Page): Promise<{ x: number; y: number; r: number }> {
  const layer = page.getByTestId('input-layer');
  const read = () =>
    layer.evaluate((el: HTMLElement) => ({
      x: Number(el.dataset.ballX),
      y: Number(el.dataset.ballY),
      r: Number(el.dataset.ballR),
      w: window.innerWidth,
      h: window.innerHeight,
    }));
  let prev = '';
  let cur = await read();
  await expect
    .poll(
      async () => {
        await page.waitForTimeout(1000);
        cur = await read();
        const key = JSON.stringify(cur);
        const ok = key === prev && cur.x > 0 && cur.x < cur.w && cur.y > 0 && cur.y < cur.h;
        prev = key;
        return ok;
      },
      { timeout: 60_000 },
    )
    .toBe(true);
  return { x: cur.x, y: cur.y, r: cur.r };
}

const intents = (page: Page): Promise<Intent[]> =>
  page.evaluate(() => (window as unknown as { __lt26: { intents: Intent[] } }).__lt26.intents.slice());

/** Points of a swipe going up the screen by `len` px with a sideways bow (+ = bulges right). */
function swipePoints(x: number, y: number, len: number, bow: number, n = 14): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= n; i += 1) {
    const f = i / n;
    pts.push({ x: x + bow * Math.sin(Math.PI * f), y: y - len * f });
  }
  return pts;
}

const touchPoint = (p: { x: number; y: number }) => [
  { x: Math.round(p.x), y: Math.round(p.y), id: 1, radiusX: 4, radiusY: 4 },
];

/**
 * Dispatch a touch swipe. With `virtualStepMs` the events carry explicit timestamps that far apart
 * (the finger speed the page measures is then independent of CDP round-trip latency).
 */
async function touchSwipe(
  page: Page,
  cdp: CDPSession,
  pts: { x: number; y: number }[],
  stepMs: number,
  holdMs = 0,
  virtualStepMs = 0,
): Promise<void> {
  let ts = Date.now() / 1000;
  const stamp = (): { timestamp?: number } => (virtualStepMs ? { timestamp: ts } : {});
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touchPoint(pts[0]), ...stamp() });
  if (holdMs) {
    await page.waitForTimeout(holdMs);
    ts += holdMs / 1000;
  }
  for (const p of pts.slice(1)) {
    ts += virtualStepMs / 1000;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touchPoint(p), ...stamp() });
    if (stepMs) await page.waitForTimeout(stepMs);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], ...stamp() });
}

async function touchSession(page: Page): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  return cdp;
}

test.describe('swipe scheme', () => {
  test('a real touch swipe that hooks right produces a strike with sideSpin > 0 and power in range', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await open(page, 'swipe', 'freeKick');
    const b = await ball(page);
    const cdp = await touchSession(page);
    // Bowing left of its chord = hooking right at the end.
    // 320 px in 7 steps of 8 ms ≈ 5.7 px/ms ≈ 1.5 m/s of finger speed.
    await touchSwipe(page, cdp, swipePoints(b.x, b.y, 320, -60, 7), 0, 0, 8);
    await expect.poll(async () => (await intents(page)).length).toBe(1);
    const [i] = await intents(page);
    expect(i.kind).toBe('strike');
    expect(i.scheme).toBe('swipe');
    expect(i.aim.kind).toBe('angles');
    expect(i.sideSpin).toBeGreaterThan(0);
    expect(i.sideSpin).toBeLessThanOrEqual(10);
    expect(i.power).toBeGreaterThan(0.1);
    expect(i.power).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });

  test('a touch swipe that hooks left gives sideSpin < 0; a slow swipe gives low power', async ({ page }) => {
    await open(page, 'swipe', 'freeKick');
    const b = await ball(page);
    const cdp = await touchSession(page);
    await touchSwipe(page, cdp, swipePoints(b.x, b.y, 200, 40, 8), 0, 0, 80);
    await expect.poll(async () => (await intents(page)).length).toBe(1);
    const [i] = await intents(page);
    expect(i.sideSpin).toBeLessThan(0);
    // 25 px every 80 ms ≈ 0.08 m/s of finger speed, below the 0.3 m/s floor.
    expect(i.power).toBeLessThan(0.1);
  });

  test('start on the top of the ball → top spin; ghost arrow is drawn while swiping', async ({ page }) => {
    await open(page, 'swipe', 'freeKick');
    const b = await ball(page);
    const cdp = await touchSession(page);
    const pts = swipePoints(b.x, b.y - Math.max(b.r, 3), 300, 0, 8);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touchPoint(pts[0]) });
    for (const p of pts.slice(1, 4)) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touchPoint(p) });
    }
    await expect(page.locator('.ghost')).toHaveClass(/is-swiping/);
    await expect(page.getByTestId('ghost-arrow')).toHaveAttribute('points', /\d/);
    for (const p of pts.slice(4)) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touchPoint(p) });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(async () => (await intents(page)).length).toBe(1);
    const [i] = await intents(page);
    expect(i.topSpin).toBeGreaterThan(0);
    await expect(page.locator('.ghost')).not.toHaveClass(/is-swiping/);
  });

  test('penalty: pressing starts the run-up, the release is the strike (with disguise)', async ({ page }) => {
    await open(page, 'swipe', 'penalty');
    await page.getByTestId('toggle-disguise').click();
    await expect(page.getByTestId('toggle-disguise')).toHaveAttribute('aria-pressed', 'true');
    await page.evaluate(() => {
      const w = window as unknown as { __runUps: number; __lt26: { sim: { startRunUp(): number } } };
      w.__runUps = 0;
      const sim = w.__lt26.sim;
      const orig = sim.startRunUp.bind(sim);
      sim.startRunUp = () => {
        w.__runUps += 1;
        return orig();
      };
    });
    const b = await ball(page);
    const cdp = await touchSession(page);
    await touchSwipe(page, cdp, swipePoints(b.x, b.y, 260, 0, 6), 0, 150);
    await expect.poll(async () => (await intents(page)).length).toBe(1);
    const [i] = await intents(page);
    expect(await page.evaluate(() => (window as unknown as { __runUps: number }).__runUps)).toBe(1);
    expect(i.kind).toBe('strike');
    expect(i.disguise).toBe(true);
  });

  test('long shot: the first swipe is a push', async ({ page }) => {
    await open(page, 'swipe', 'longShot');
    const b = await ball(page);
    const cdp = await touchSession(page);
    await touchSwipe(page, cdp, swipePoints(b.x, b.y, 150, 0, 6), 0, 0, 30);
    await expect.poll(async () => (await intents(page)).length).toBe(1);
    expect((await intents(page))[0].kind).toBe('push');
  });

  test('mouse drags map to the same swipe gesture', async ({ page }) => {
    await open(page, 'swipe', 'freeKick');
    const b = await ball(page);
    await page.mouse.move(b.x, b.y);
    await page.mouse.down();
    for (const p of swipePoints(b.x, b.y, 300, 60).slice(1)) await page.mouse.move(p.x, p.y);
    await page.mouse.up();
    await expect.poll(async () => (await intents(page)).length).toBe(1);
    const [i] = await intents(page);
    expect(i.scheme).toBe('swipe');
    expect(i.sideSpin).toBeLessThan(0);
  });
});

test.describe('dial scheme', () => {
  test('drag reticle, hold/release power, turn the knobs, Shoot → target intent', async ({ page }) => {
    const errors = watchErrors(page);
    await open(page, 'dial', 'freeKick');
    const reticle = page.getByTestId('reticle');
    await expect(reticle).toBeVisible();
    // Wait until the reticle sits still on screen (the kick camera settles over the first frames).
    await ball(page);
    const r = (await reticle.boundingBox())!;
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    // Drag the reticle 80 px right and 30 px up.
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 40, cy - 15, { steps: 4 });
    await page.mouse.move(cx + 80, cy - 30, { steps: 4 });
    await page.mouse.up();
    await expect(page.getByTestId('dial-aim-value')).not.toHaveText(/x 0\.00 m/);

    // Hold the power bar ~0.5 s, release.
    const bar = (await page.getByTestId('power-bar').boundingBox())!;
    await page.mouse.move(bar.x + 20, bar.y + bar.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(500);
    await page.mouse.up();
    const pct = Number((await page.getByTestId('dial-power-value').textContent())!.split(' ')[0]);
    expect(pct).toBeGreaterThan(20);
    expect(pct).toBeLessThanOrEqual(100);

    // Curve knob: drag up 50 px = +5 rev/s.
    const k = (await page.getByTestId('knob-curve').boundingBox())!;
    await page.mouse.move(k.x + k.width / 2, k.y + 30);
    await page.mouse.down();
    await page.mouse.move(k.x + k.width / 2, k.y + 5, { steps: 3 });
    await page.mouse.move(k.x + k.width / 2, k.y - 20, { steps: 3 });
    await page.mouse.up();
    await expect(page.getByTestId('knob-curve-value')).toHaveText('+5.0 rev/s');
    // Dip knob via keyboard: two steps down = −1.0 (back spin).
    await page.getByTestId('knob-dip').focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('knob-dip-value')).toHaveText('−1.0 rev/s');

    const shoot = page.getByTestId('btn-shoot');
    const sb = (await shoot.boundingBox())!;
    expect(Math.min(sb.width, sb.height)).toBeGreaterThanOrEqual(64);
    await shoot.click();
    await expect.poll(async () => (await intents(page)).length).toBe(1);
    const [i] = await intents(page);
    expect(i.scheme).toBe('dial');
    expect(i.kind).toBe('strike');
    expect(i.aim.kind).toBe('target');
    if (i.aim.kind === 'target') {
      expect(i.aim.x).toBeGreaterThan(0);
      expect(i.aim.y).toBeGreaterThan(0);
    }
    expect(i.sideSpin).toBe(5);
    expect(i.topSpin).toBe(-1);
    expect(i.power).toBeCloseTo(pct / 100, 2);
    expect(errors).toEqual([]);
  });

  test('a quick tap on the power bar sets that exact power (repeatable)', async ({ page }) => {
    await open(page, 'dial', 'freeKick');
    const bar = (await page.getByTestId('power-bar').boundingBox())!;
    await page.mouse.click(bar.x + bar.width * 0.8, bar.y + bar.height / 2);
    await expect(page.getByTestId('dial-power-value')).toHaveText(/^80 % · 100 km\/h$/);
  });

  test('penalty: hold Shoot runs up (timing shown), release strikes', async ({ page }) => {
    await open(page, 'dial', 'penalty');
    const s = (await page.getByTestId('btn-shoot').boundingBox())!;
    await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
    await page.mouse.down();
    await expect(page.getByTestId('timing')).toBeVisible();
    await page.waitForTimeout(300);
    await page.mouse.up();
    await expect.poll(async () => (await intents(page)).length).toBe(1);
    const [i] = await intents(page);
    expect(i.kind).toBe('strike');
    expect(i.aim.kind).toBe('target');
  });

  test('keyboard: arrows move the reticle, Space shoots', async ({ page }) => {
    await open(page, 'dial', 'freeKick');
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('ArrowUp');
    await expect(page.getByTestId('dial-aim-value')).toHaveText('Aim x −0.50 m · height 1.60 m');
    await page.keyboard.down('Space');
    await page.keyboard.up('Space');
    await expect.poll(async () => (await intents(page)).length).toBe(1);
    const [i] = await intents(page);
    expect(i.aim).toEqual({ kind: 'target', x: -0.5, y: 1.6 });
  });
});
