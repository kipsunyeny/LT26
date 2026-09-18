// UI E2E: navigation, settings persistence, reset confirm, HUD layout (Talilei's corner stays
// free of controls), rotate prompt, spot selection. Independent of the sim's kick outcome.
import { expect, test, type Page } from '@playwright/test';

// Headless WebGL (SwiftShader) is very slow on the high-DPR tablet profile: triple time.
test.beforeEach(() => test.slow());

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => {
    errors.push(`unexpected dialog: ${d.type()}`);
    void d.dismiss();
  });
  return errors;
}

const screen = (page: Page): Promise<string> =>
  page.evaluate(() => (window as unknown as { __lt26: { screen(): string } }).__lt26.screen());

const simMode = (page: Page): Promise<string> =>
  page.evaluate(() => (window as unknown as { __lt26: { sim: { state: { mode: string } } } }).__lt26.sim.state.mode);

test('navigates between all screens without console errors', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./');
  await expect(page.getByTestId('talilei')).toBeVisible();
  await expect(page.getByTestId('title-logo')).toBeVisible();
  expect(await screen(page)).toBe('title');

  for (const mode of ['freeKick', 'penalty', 'longShot'] as const) {
    await page.getByTestId(`btn-mode-${mode}`).click();
    await expect(page.getByTestId('hud')).toBeVisible();
    await expect(page.getByTestId('hud-logo')).toBeVisible();
    expect(await screen(page)).toBe('play');
    expect(await simMode(page)).toBe(mode);
    await expect(page.getByTestId(`tab-${mode}`)).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('btn-back').click();
    expect(await screen(page)).toBe('title');
  }

  await page.getByTestId('btn-mode-freeKick').click();
  await expect(page.getByTestId('minimap')).toBeVisible();
  await expect(page.getByTestId('spot-fk-centre')).toBeVisible();
  await page.getByTestId('tab-penalty').click();
  await expect(page.getByTestId('toggle-disguise')).toBeVisible();
  await expect(page.getByTestId('minimap')).toHaveCount(0);
  await page.getByTestId('tab-longShot').click();
  await expect(page.getByTestId('spot-ls-left')).toBeVisible();
  await page.getByTestId('btn-back').click();

  await page.getByTestId('btn-stats').click();
  await expect(page.getByTestId('stats-table')).toBeVisible();
  expect(await screen(page)).toBe('stats');
  await page.getByTestId('btn-back').click();
  await page.getByTestId('btn-settings').click();
  await expect(page.getByTestId('setting-scheme')).toBeVisible();
  expect(await screen(page)).toBe('settings');
  await page.getByTestId('btn-back').click();
  expect(await screen(page)).toBe('title');
  expect(errors).toEqual([]);
});

test('settings persist across reload and reach the sim', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./');
  await page.getByTestId('btn-settings').click();
  await page.getByTestId('setting-scheme').selectOption('dial');
  await page.getByTestId('setting-altitude').selectOption('sea');
  await page.getByTestId('setting-footed').selectOption('left');
  await page.getByTestId('setting-sound').uncheck();
  await page.reload();
  await page.getByTestId('btn-settings').click();
  await expect(page.getByTestId('setting-scheme')).toHaveValue('dial');
  await expect(page.getByTestId('setting-altitude')).toHaveValue('sea');
  await expect(page.getByTestId('setting-footed')).toHaveValue('left');
  await expect(page.getByTestId('setting-sound')).not.toBeChecked();
  const s = await page.evaluate(
    () => (window as unknown as { __lt26: { sim: { state: { settings: unknown } } } }).__lt26.sim.state.settings,
  );
  expect(s).toEqual({ controlScheme: 'dial', altitude: 'sea', sound: false, footed: 'left' });
  // The play screen uses the chosen scheme, and left-footed labels mirror.
  await page.getByTestId('btn-back').click();
  await page.getByTestId('btn-mode-freeKick').click();
  await expect(page.getByTestId('input-layer')).toHaveAttribute('data-scheme', 'dial');
  await page.getByTestId('knob-curve').focus();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByTestId('knob-curve')).toContainText('inside · curls right');
  expect(errors).toEqual([]);
});

test('reset data uses an inline confirmation', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./');
  await page.getByTestId('btn-settings').click();
  await page.getByTestId('btn-reset-data').click();
  await expect(page.getByTestId('btn-reset-confirm')).toBeVisible();
  await page.getByTestId('btn-reset-cancel').click();
  await expect(page.getByTestId('btn-reset-confirm')).toBeHidden();
  await page.getByTestId('btn-reset-data').click();
  await page.getByTestId('btn-reset-confirm').click();
  await expect(page.getByTestId('reset-status')).toHaveText(/deleted/);
  expect(errors).toEqual([]);
});

test('free kick spot presets and mini-map drag call the sim', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('btn-mode-freeKick').click();
  await page.evaluate(() => {
    const w = window as unknown as { __spots: unknown[]; __lt26: { sim: { setSpot(s: unknown): void } } };
    w.__spots = [];
    const sim = w.__lt26.sim;
    const orig = sim.setSpot.bind(sim);
    sim.setSpot = (s: unknown) => {
      w.__spots.push(s);
      orig(s);
    };
  });
  await page.getByTestId('spot-fk-left-d').click();
  const mm = (await page.getByTestId('minimap').boundingBox())!;
  await page.mouse.move(mm.x + mm.width * 0.7, mm.y + mm.height * 0.7);
  await page.mouse.down();
  await page.mouse.move(mm.x + mm.width * 0.75, mm.y + mm.height * 0.75, { steps: 3 });
  await page.mouse.up();
  const spots = await page.evaluate(() => (window as unknown as { __spots: unknown[] }).__spots);
  expect(spots[0]).toBe('fk-left-d');
  const placed = spots[1] as { x: number; z: number };
  const d = Math.hypot(placed.x, placed.z);
  expect(d).toBeGreaterThanOrEqual(15.5);
  expect(d).toBeLessThanOrEqual(35.5);
  expect(placed.x).toBeGreaterThan(0);
});

interface Box {
  id: string;
  interactive: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
}

const intersects = (
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
) => a.w > 0 && b.w > 0 && a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

async function seed(page: Page, s: { controlScheme: 'swipe' | 'dial'; footed: 'right' | 'left' }): Promise<void> {
  await page.addInitScript((v) => {
    localStorage.setItem('lt26.settings.v1', JSON.stringify({ altitude: 'nairobi', sound: false, ...v }));
  }, s);
}

/** Ball screen position once the kick camera has settled (two reads a second apart agree). */
async function stableBall(page: Page): Promise<{ x: number; y: number; r: number }> {
  const layer = page.getByTestId('input-layer');
  const read = () =>
    layer.evaluate((el: HTMLElement) => ({
      x: Number(el.dataset.ballX),
      y: Number(el.dataset.ballY),
      r: Number(el.dataset.ballR),
      w: innerWidth,
      h: innerHeight,
      t: (window as unknown as { __lt26: { sim: { state: { time: number } } } }).__lt26.sim.state.time,
    }));
  let prev = '';
  let same = 0;
  let cur = await read();
  await expect
    .poll(
      async () => {
        await page.waitForTimeout(1000);
        const last = cur;
        cur = await read();
        // Stable = same position across two reads with at least one animation frame between them
        // (sim time advanced), twice in a row. Frames can take seconds under SwiftShader.
        const key = `${cur.x},${cur.y},${cur.r}`;
        same = key === prev && cur.t > last.t ? same + 1 : key === prev ? same : 0;
        prev = key;
        return same >= 2 && cur.x > 0 && cur.x < cur.w && cur.y > 0 && cur.y < cur.h;
      },
      { timeout: 60_000 },
    )
    .toBe(true);
  return cur;
}

const hudBoxes = (page: Page): Promise<Box[]> =>
  page.evaluate(() => {
    const sel = [
      '[data-testid="hud"] button',
      '[data-testid="hud"] [role="slider"]',
      '.hud-nav',
      '.hint',
      '.hud-logo',
      '.hud-side',
      '.dial-panel',
      '.card-holder',
    ].join(', ');
    return [...document.querySelectorAll<HTMLElement>(sel)]
      .filter((e) => e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden')
      .map((e) => {
        const r = e.getBoundingClientRect();
        const interactive = e.tagName === 'BUTTON' || e.getAttribute('role') === 'slider';
        return { id: e.dataset.testid ?? e.className, interactive, x: r.x, y: r.y, w: r.width, h: r.height };
      });
  });

/** The containers that must not overlap each other. */
const CONTAINERS = ['hud-nav', 'hint', 'hud-logo', 'hud-side', 'dial-panel', 'card-holder'];

const LAYOUTS: { width: number; height: number; footed: 'right' | 'left' }[] = [
  { width: 1280, height: 800, footed: 'right' },
  { width: 1280, height: 800, footed: 'left' },
  { width: 1920, height: 1200, footed: 'right' },
  { width: 1920, height: 1200, footed: 'left' },
  { width: 1024, height: 600, footed: 'right' },
  { width: 1024, height: 600, footed: 'left' },
  { width: 800, height: 500, footed: 'right' },
  { width: 740, height: 360, footed: 'right' },
  { width: 740, height: 360, footed: 'left' },
];

for (const L of LAYOUTS) {
  for (const scheme of ['dial', 'swipe'] as const) {
    test(`HUD layout ${L.width}×${L.height} ${L.footed}-footed ${scheme}: Talilei's corner, the ball and the panels stay clear`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: L.width, height: L.height });
      await seed(page, { controlScheme: scheme, footed: L.footed });
      await page.goto('./');
      // Talilei stands beside the ball on his kicking-foot side: bottom-left for right-footers,
      // bottom-right for left-footers (30 % × 45 % of the screen).
      const zone = {
        x: L.footed === 'right' ? 0 : L.width * 0.7,
        y: L.height * 0.55,
        w: L.width * 0.3,
        h: L.height * 0.45,
      };
      for (const mode of ['freeKick', 'penalty', 'longShot'] as const) {
        await page.getByTestId(`btn-mode-${mode}`).click();
        await expect(page.getByTestId('input-layer')).toHaveAttribute('data-scheme', scheme);
        const ball = await stableBall(page);
        const boxes = await hudBoxes(page);
        const tag = `${L.width}×${L.height} ${L.footed} ${scheme} ${mode}`;
        expect(boxes.length, tag).toBeGreaterThan(3);
        expect(
          boxes.filter((b) => intersects(b, zone)).map((b) => b.id),
          `${tag}: in Talilei's corner`,
        ).toEqual([]);
        const r = Math.max(ball.r, 8) * 1.2;
        const ballBox = { x: ball.x - r, y: ball.y - r, w: 2 * r, h: 2 * r };
        expect(
          boxes.filter((b) => intersects(b, ballBox)).map((b) => b.id),
          `${tag}: over the ball at ${JSON.stringify(ball)}`,
        ).toEqual([]);
        const cont = boxes.filter((b) => CONTAINERS.some((c) => String(b.id).split(' ').includes(c)));
        const clashes: string[] = [];
        for (let i = 0; i < cont.length; i += 1)
          for (let j = i + 1; j < cont.length; j += 1)
            if (intersects(cont[i], cont[j])) clashes.push(`${cont[i].id} × ${cont[j].id}`);
        expect(clashes, `${tag}: overlapping panels`).toEqual([]);
        const offscreen = boxes.filter(
          (b) => b.x < 0 || b.y < 0 || b.x + b.w > L.width + 0.5 || b.y + b.h > L.height + 0.5,
        );
        expect(
          offscreen.map((b) => b.id),
          `${tag}: off screen`,
        ).toEqual([]);
        const small = boxes.filter((b) => b.interactive && (b.w < 44 || b.h < 44));
        expect(
          small.map((b) => b.id),
          `${tag}: small targets`,
        ).toEqual([]);
        await page.getByTestId('btn-back').click();
      }
    });
  }
}

for (const L of [
  { width: 740, height: 360, footed: 'right' as const },
  { width: 740, height: 360, footed: 'left' as const },
  { width: 1024, height: 600, footed: 'right' as const },
]) {
  test(`shot card fits with its buttons visible at ${L.width}×${L.height} (${L.footed}-footed)`, async ({ page }) => {
    await page.setViewportSize({ width: L.width, height: L.height });
    await seed(page, { controlScheme: 'dial', footed: L.footed });
    await page.goto('./');
    await page.getByTestId('btn-mode-freeKick').click();
    await stableBall(page);
    await page.getByTestId('btn-shoot').click();
    const card = page.getByTestId('shot-card');
    await expect(card).toBeVisible({ timeout: 120_000 });
    const c = (await card.boundingBox())!;
    expect(c.y).toBeGreaterThanOrEqual(0);
    expect(c.y + c.height).toBeLessThanOrEqual(L.height);
    expect(c.x).toBeGreaterThanOrEqual(0);
    expect(c.x + c.width).toBeLessThanOrEqual(L.width);
    for (const id of ['btn-next', 'btn-replay']) {
      const b = (await page.getByTestId(id).boundingBox())!;
      expect(b.y + b.height, id).toBeLessThanOrEqual(L.height);
      expect(b.height, id).toBeGreaterThanOrEqual(44);
    }
    // Nothing interactive sits on top of the card.
    const boxes = await hudBoxes(page);
    const cardBox = { x: c.x, y: c.y, w: c.width, h: c.height };
    const under = boxes.filter(
      (b) => !['shot-card', 'btn-next', 'btn-replay', 'card-holder'].includes(String(b.id)) && intersects(b, cardBox),
    );
    expect(under.map((b) => b.id)).toEqual([]);
    await page.getByTestId('btn-next').click();
    await expect(card).toHaveCount(0);
  });
}

test('rotate prompt shows in portrait only', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByTestId('rotate-prompt')).toBeHidden();
  await page.setViewportSize({ width: 600, height: 900 });
  await expect(page.getByTestId('rotate-prompt')).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByTestId('rotate-prompt')).toBeHidden();
});
