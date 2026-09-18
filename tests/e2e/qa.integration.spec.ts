// QA integration E2E (brief §7.2): a real touch swipe in each mode produces a kick, a trajectory and a
// result with a sane shot card; dial + mouse on desktop; the replay plays the recorded frames with the
// recorded path as trail; stats survive a reload; no console errors throughout.
import { expect, test, type Page } from '@playwright/test';
import {
  advanceUntil,
  ballNow,
  eventTypes,
  freezeSimClock,
  runToContactAndFreeze,
  expectSaneSummary,
  intentCount,
  lastShot,
  mouseSwipe,
  openMode,
  seedSettings,
  stableBall,
  swipePoints,
  touchDown,
  touchMoveUp,
  touchSession,
  touchSwipe,
  watchErrors,
  type Mode,
} from './helpers/qa';

// SwiftShader WebGL is slow (very slow on the high-DPR tablet profile): triple time.
test.beforeEach(() => test.slow());

const num = async (page: Page, id: string): Promise<number> =>
  Number(((await page.getByTestId(id).textContent()) ?? '').replace('−', '-').split(' ')[0]);

/** After a kick: fly it to the result (sim clock), then check the shot card and the summary. */
async function finishAndCheckCard(page: Page, mode: Mode, maxKmh = 115): Promise<void> {
  await expect.poll(async () => (await eventTypes(page)).includes('kick')).toBe(true);
  const start = await page.evaluate(() => {
    const s = (window as unknown as { __lt26: { sim: { state: { ballStart: { z: number } } } } }).__lt26.sim.state;
    return s.ballStart.z;
  });
  expect(await advanceUntil(page, 'result')).toBe('result');
  // Let the 0.5 s recording tail complete.
  await page.evaluate(() => {
    const sim = (window as unknown as { __lt26: { sim: { update(dt: number): void } } }).__lt26.sim;
    for (let i = 0; i < 8; i += 1) sim.update(0.1);
  });
  const types = await eventTypes(page);
  expect(types).toContain('result');
  const s = await lastShot(page);
  expectSaneSummary(s, { maxKmh });
  // The ball actually moved (trajectory towards the goal).
  const moved = await page.evaluate(() => {
    const st = (window as unknown as { __lt26: { sim: { state: { lastShot: { path: { z: number }[] } } } } }).__lt26.sim
      .state;
    const p = st.lastShot.path;
    return p[0].z - Math.min(...p.map((q) => q.z));
  });
  expect(moved).toBeGreaterThan(Math.min(3, start * 0.2));
  expect(
    await page.evaluate(
      () => (window as unknown as { __lt26: { sim: { state: { mode: string } } } }).__lt26.sim.state.mode,
    ),
  ).toBe(mode);

  await expect(page.getByTestId('shot-card')).toBeVisible();
  const speed = await num(page, 'shot-speed');
  expect(speed).toBeGreaterThanOrEqual(40);
  expect(speed).toBeLessThanOrEqual(maxKmh);
  expect(speed).toBeCloseTo(s!.speedKmh, 0);
  expect(await num(page, 'shot-apex')).toBeGreaterThanOrEqual(0.11);
  expect(await num(page, 'shot-time')).toBeGreaterThan(0);
  await expect(page.getByTestId('shot-result')).not.toBeEmpty();
}

async function statsAttempts(page: Page, spot: string): Promise<number> {
  await page.getByTestId('btn-stats').click();
  await expect(page.getByTestId('stats-table')).toBeVisible();
  const row = page.locator(`[data-testid="stats-table"] tr[data-spot="${spot}"] td.num`).first();
  const n = (await row.count()) ? Number(await row.textContent()) : 0;
  await page.getByTestId('btn-back').click();
  return n;
}

test.describe('touch swipe, every mode', () => {
  test('free kick: touch swipe → kick, trajectory, result, shot card; replay plays the recording', async ({ page }) => {
    const errors = watchErrors(page);
    await seedSettings(page, { controlScheme: 'swipe' });
    await openMode(page, 'freeKick', 'swipe');
    const b = await stableBall(page);
    const cdp = await touchSession(page);
    // Hooks right (bows left of the chord); start slightly low on the ball to lift it.
    await touchSwipe(cdp, swipePoints(b.x, b.y + b.r * 0.6, 400, -50, 10), 5);
    await expect.poll(() => intentCount(page)).toBe(1);
    await finishAndCheckCard(page, 'freeKick');

    // Replay: capture the trail the scene is given and the worlds it renders.
    await page.evaluate(() => {
      const w = window as unknown as {
        __qa: { trails: number[]; ts: number[] };
        __lt26: {
          scene: {
            setTrail(p: unknown[] | null, g?: unknown): void;
            render(world: { t: number }, dt: number): void;
          };
        };
      };
      w.__qa = { trails: [], ts: [] };
      const sc = w.__lt26.scene;
      const st = sc.setTrail.bind(sc);
      sc.setTrail = (p, g) => {
        w.__qa.trails.push(p ? p.length : -1);
        st(p, g);
      };
      const r = sc.render.bind(sc);
      sc.render = (world, dt) => {
        w.__qa.ts.push(world.t);
        r(world, dt);
      };
    });
    await page.getByTestId('btn-replay').click();
    await expect(page.getByTestId('replay')).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __lt26: { screen(): string } }).__lt26.screen())).toBe(
      'replay',
    );
    const rec = await page.evaluate(() => {
      const st = (
        window as unknown as {
          __lt26: {
            sim: { state: { lastShot: { path: unknown[] }; lastRecording: { frames: { t: number }[] } } };
            events: { type: string; t: number }[];
          };
        }
      ).__lt26;
      const kick = st.events.find((e) => e.type === 'kick')!;
      const res = st.events.find((e) => e.type === 'result')!;
      return {
        pathLen: st.sim.state.lastShot.path.length,
        frames: st.sim.state.lastRecording.frames.length,
        frameTs: st.sim.state.lastRecording.frames.map((f) => f.t),
        expected: Math.floor((res.t - kick.t + 0.5) * 60) + 1,
      };
    });
    // 60 Hz from the strike to the result + 0.5 s.
    expect(Math.abs(rec.frames - rec.expected)).toBeLessThanOrEqual(2);
    await page.evaluate(() => {
      (window as unknown as { __qa: { ts: number[] } }).__qa.ts = [];
    });
    await expect(page.getByTestId('replay-path')).toHaveAttribute('points', /\d+(\.\d+)?,\d/);
    // Replay frames advance and every rendered world is a recorded frame (never a re-simulation).
    // Headless frames are slow (well under 1 fps on the tablet profile): wait for several replay frames.
    await expect
      .poll(() => page.evaluate(() => new Set((window as unknown as { __qa: { ts: number[] } }).__qa.ts).size), {
        timeout: 90_000,
      })
      .toBeGreaterThan(2);
    const qa = await page.evaluate(() => (window as unknown as { __qa: { trails: number[]; ts: number[] } }).__qa);
    expect(qa.trails).toContain(rec.pathLen);
    const recorded = new Set(rec.frameTs);
    const replayTs = qa.ts.filter((t) => recorded.has(t));
    expect(replayTs.length).toBe(qa.ts.length);
    expect(new Set(replayTs).size).toBeGreaterThan(1);
    for (let i = 1; i < replayTs.length; i += 1) expect(replayTs[i]).toBeGreaterThanOrEqual(replayTs[i - 1]);
    expect(errors).toEqual([]);
  });

  test('penalty: hold (run-up), swipe, release → kick with timing, result, shot card', async ({ page }) => {
    const errors = watchErrors(page);
    await seedSettings(page, { controlScheme: 'swipe' });
    await openMode(page, 'penalty', 'swipe');
    const b = await stableBall(page);
    const cdp = await touchSession(page);
    const pts = swipePoints(b.x, b.y, 360, 0, 10).map((p, i) => ({ x: p.x - i * 12, y: p.y }));
    const ts = await touchDown(cdp, pts[0]);
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { __lt26: { sim: { state: { phase: string } } } }).__lt26.sim.state.phase,
        ),
      )
      .toBe('runUp');
    // Run the taker up to 20 ms before the contact point and hold the sim clock there for the swipe (each CDP
    // event waits for a slow headless frame); release it once the strike is in.
    await runToContactAndFreeze(page, -0.02);
    await touchMoveUp(cdp, pts, 6, ts);
    await expect.poll(() => intentCount(page)).toBe(1);
    await freezeSimClock(page, false);
    await finishAndCheckCard(page, 'penalty');
    await expect(page.getByTestId('shot-timing')).toHaveText(/perfect/);
    await expect(page.getByTestId('shot-timing')).toHaveText(/ms · (perfect|early|late)/);
    expect(errors).toEqual([]);
  });

  test('long shot: push swipe, then strike swipe on the rolling ball → result, shot card', async ({ page }) => {
    const errors = watchErrors(page);
    await seedSettings(page, { controlScheme: 'swipe' });
    await openMode(page, 'longShot', 'swipe');
    const b = await stableBall(page);
    const cdp = await touchSession(page);
    await touchSwipe(cdp, swipePoints(b.x, b.y, 150, 0, 6), 30);
    await expect.poll(() => intentCount(page)).toBe(1);
    await expect.poll(async () => (await eventTypes(page)).includes('push')).toBe(true);
    // Run to 20 ms before the ideal contact and hold the sim clock there while the strike swipe is dispatched.
    await runToContactAndFreeze(page, -0.02);
    const nb = await ballNow(page);
    await touchSwipe(cdp, swipePoints(nb.x, nb.y, 360, -30, 10), 6);
    await expect.poll(() => intentCount(page)).toBe(2);
    await freezeSimClock(page, false);
    const kinds = await page.evaluate(() =>
      (window as unknown as { __lt26: { intents: { kind: string }[] } }).__lt26.intents.map((i) => i.kind),
    );
    expect(kinds).toEqual(['push', 'strike']);
    // A moving ball adds its velocity to the kick (brief §1.1), up to the 6 m/s push = 21.6 km/h.
    await finishAndCheckCard(page, 'longShot', 115 + 21.6);
    expect(errors).toEqual([]);
  });
});

test.describe('dial scheme with the mouse', () => {
  test('free kick: power bar + knob + Shoot by mouse → result and shot card', async ({ page }) => {
    const errors = watchErrors(page);
    await seedSettings(page, { controlScheme: 'dial' });
    await openMode(page, 'freeKick', 'dial');
    await stableBall(page);
    const bar = (await page.getByTestId('power-bar').boundingBox())!;
    await page.mouse.click(bar.x + bar.width * 0.7, bar.y + bar.height / 2);
    await expect(page.getByTestId('dial-power-value')).toHaveText(/^70 %/);
    await page.getByTestId('knob-curve').focus();
    for (let i = 0; i < 6; i += 1) await page.keyboard.press('ArrowUp');
    await page.getByTestId('btn-shoot').click();
    await expect.poll(() => intentCount(page)).toBe(1);
    await finishAndCheckCard(page, 'freeKick');
    expect(errors).toEqual([]);
  });

  test('penalty: hold Shoot with the mouse (run-up), release → result', async ({ page }) => {
    const errors = watchErrors(page);
    await seedSettings(page, { controlScheme: 'dial' });
    await openMode(page, 'penalty', 'dial');
    await stableBall(page);
    const s = (await page.getByTestId('btn-shoot').boundingBox())!;
    await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
    await page.mouse.down();
    await expect(page.getByTestId('timing')).toBeVisible();
    await page.waitForTimeout(400);
    await page.mouse.up();
    await expect.poll(() => intentCount(page)).toBe(1);
    await finishAndCheckCard(page, 'penalty');
    expect(errors).toEqual([]);
  });
});

test('mouse swipe on desktop: free kick → result; stats survive a reload', async ({ page }) => {
  const errors = watchErrors(page);
  await seedSettings(page, { controlScheme: 'swipe' });
  await openMode(page, 'freeKick', 'swipe');
  for (let k = 0; k < 2; k += 1) {
    const b = await stableBall(page);
    await mouseSwipe(page, swipePoints(b.x, b.y, 300, 30, 12));
    await expect.poll(() => intentCount(page)).toBe(k + 1);
    await finishAndCheckCard(page, 'freeKick');
    await page.getByTestId('btn-next').click();
    await expect(page.getByTestId('shot-card')).toHaveCount(0);
  }
  await page.getByTestId('btn-back').click();
  expect(await statsAttempts(page, 'fk-centre')).toBe(2);
  await page.reload();
  await page.waitForFunction(() => '__lt26' in window);
  expect(await statsAttempts(page, 'fk-centre')).toBe(2);
  expect(errors).toEqual([]);
});

test('left-footed free kick through the UI: kick, result and an inside/outside label on the card', async ({ page }) => {
  const errors = watchErrors(page);
  await seedSettings(page, { controlScheme: 'dial', footed: 'left' });
  await openMode(page, 'freeKick', 'dial');
  await stableBall(page);
  const bar = (await page.getByTestId('power-bar').boundingBox())!;
  await page.mouse.click(bar.x + bar.width * 0.7, bar.y + bar.height / 2);
  await page.getByTestId('knob-curve').focus();
  for (let i = 0; i < 6; i += 1) await page.keyboard.press('ArrowUp');
  // Left-footer, + side spin (curls right) = inside of the foot.
  await expect(page.getByTestId('knob-curve')).toContainText('inside · curls right');
  await page.getByTestId('btn-shoot').click();
  await expect.poll(() => intentCount(page)).toBe(1);
  await finishAndCheckCard(page, 'freeKick');
  await expect(page.getByTestId('shot-foot')).toHaveText(/^(inside|outside) · curls (left|right)$/);
  await expect(page.getByTestId('shot-foot')).toHaveText('inside · curls right');
  expect(errors).toEqual([]);
});

test('penalty: a tap on the ball (no swipe) cancels the run-up and leaves the phase aiming', async ({ page }) => {
  const errors = watchErrors(page);
  await seedSettings(page, { controlScheme: 'swipe' });
  await openMode(page, 'penalty', 'swipe');
  const b = await stableBall(page);
  const cdp = await touchSession(page);
  const ts = await touchDown(cdp, b);
  await expect.poll(async () => (await eventTypes(page)).includes('runUpStart')).toBe(true);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: ts + 0.05 });
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __lt26: { sim: { state: { phase: string } } } }).__lt26.sim.state.phase,
      ),
    )
    .toBe('aiming');
  expect(await intentCount(page)).toBe(0);
  const types = await eventTypes(page);
  expect(types).not.toContain('kick');
  // Stays aiming as the sim clock runs on (no delayed strike or scuff).
  await page.evaluate(() => {
    const sim = (window as unknown as { __lt26: { sim: { update(dt: number): void } } }).__lt26.sim;
    for (let i = 0; i < 20; i += 1) sim.update(0.1);
  });
  expect(
    await page.evaluate(
      () => (window as unknown as { __lt26: { sim: { state: { phase: string } } } }).__lt26.sim.state.phase,
    ),
  ).toBe('aiming');
  await expect(page.getByTestId('timing')).toBeHidden();
  expect(errors).toEqual([]);
});
