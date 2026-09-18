// Shared helpers for the QA specs: console-error watch, settings, ball position, CDP touch swipes,
// and typed access to the debug hook (window.__lt26) from page.evaluate.
import { expect, type CDPSession, type Page } from '@playwright/test';

export type Mode = 'freeKick' | 'penalty' | 'longShot';
export type Scheme = 'swipe' | 'dial';

export interface Pt {
  x: number;
  y: number;
}

export interface QaSettings {
  controlScheme: Scheme;
  altitude: 'nairobi' | 'sea';
  sound: boolean;
  footed: 'right' | 'left';
}

export interface SummaryLite {
  result: string;
  speedKmh: number;
  spinRps: number;
  lateralCurveM: number;
  apexM: number;
  timeToGoalS: number;
  crossing: { x: number; y: number } | null;
  missDistanceM: number;
  pathLength: number;
}

/** Collects console errors and page errors for the lifetime of the page. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

/** Seeds the persisted settings before the app boots (every navigation in this page). */
export async function seedSettings(page: Page, s: Partial<QaSettings> = {}): Promise<void> {
  const full: QaSettings = { controlScheme: 'swipe', altitude: 'nairobi', sound: false, footed: 'right', ...s };
  await page.addInitScript((v) => {
    if (!sessionStorage.getItem('qa.seeded')) {
      localStorage.setItem('lt26.settings.v1', JSON.stringify(v));
      sessionStorage.setItem('qa.seeded', '1');
    }
  }, full);
}

/** Freezes Date.now() so main.ts seeds the sim identically on every boot (deterministic kicks). */
export async function freezeSeed(page: Page, at = 1_750_000_000_000): Promise<void> {
  await page.addInitScript((t) => {
    Date.now = () => t;
  }, at);
}

export async function openMode(page: Page, mode: Mode, scheme: Scheme): Promise<void> {
  await page.goto('./');
  await page.waitForFunction(() => '__lt26' in window);
  await page.getByTestId(`btn-mode-${mode}`).click();
  await expect(page.getByTestId('hud')).toBeVisible();
  await expect(page.getByTestId('input-layer')).toHaveAttribute('data-scheme', scheme);
}

/** Ball screen position from the input layer; waits until it is on screen and stable. */
export async function stableBall(page: Page, timeout = 60_000): Promise<{ x: number; y: number; r: number }> {
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
        await page.waitForTimeout(500);
        cur = await read();
        const key = JSON.stringify(cur);
        const ok = key === prev && cur.x > 0 && cur.x < cur.w && cur.y > 0 && cur.y < cur.h;
        prev = key;
        return ok;
      },
      { timeout },
    )
    .toBe(true);
  return { x: cur.x, y: cur.y, r: cur.r };
}

/** Waits for two animation frames (the HUD refreshes the ball position once per frame). */
export async function nextFrames(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
}

/** Current ball screen position (after the next frames) without waiting for stability. */
export async function ballNow(page: Page): Promise<{ x: number; y: number; r: number }> {
  await nextFrames(page);
  return page.getByTestId('input-layer').evaluate((el: HTMLElement) => ({
    x: Number(el.dataset.ballX),
    y: Number(el.dataset.ballY),
    r: Number(el.dataset.ballR),
  }));
}

/** Points of a swipe going up the screen by `len` px with a sideways bow (+ = bulges right). */
export function swipePoints(x: number, y: number, len: number, bow: number, n = 10): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i += 1) {
    const f = i / n;
    pts.push({ x: x + bow * Math.sin(Math.PI * f), y: y - len * f });
  }
  return pts;
}

export async function touchSession(page: Page): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  return cdp;
}

const tp = (p: Pt) => [{ x: Math.round(p.x), y: Math.round(p.y), id: 1, radiusX: 4, radiusY: 4 }];

/** CDP touch: finger down only (penalty run-up starts on the press). Returns the virtual clock (s). */
export async function touchDown(cdp: CDPSession, p: Pt): Promise<number> {
  const ts = Date.now() / 1000;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(p), timestamp: ts });
  return ts;
}

/**
 * Moves through `pts` (the first point is where the finger already is) and lifts off. Event timestamps
 * are virtual, `stepMs` apart, so the finger speed the page measures does not depend on CDP latency.
 */
export async function touchMoveUp(cdp: CDPSession, pts: Pt[], stepMs: number, ts0: number): Promise<void> {
  let ts = Math.max(ts0, Date.now() / 1000);
  for (const p of pts.slice(1)) {
    ts += stepMs / 1000;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(p), timestamp: ts });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: ts });
}

export async function touchSwipe(cdp: CDPSession, pts: Pt[], stepMs: number): Promise<void> {
  const ts = await touchDown(cdp, pts[0]);
  await touchMoveUp(cdp, pts, stepMs, ts);
}

/** Mouse drag along the points (desktop mapping of the swipe). */
export async function mouseSwipe(page: Page, pts: Pt[]): Promise<void> {
  await page.mouse.move(pts[0].x, pts[0].y);
  await page.mouse.down();
  for (const p of pts.slice(1)) await page.mouse.move(p.x, p.y);
  await page.mouse.up();
}

export const intentCount = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as { __lt26: { intents: unknown[] } }).__lt26.intents.length);

export const eventTypes = (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    (window as unknown as { __lt26: { events: { type: string }[] } }).__lt26.events.map((e) => e.type),
  );

export const phase = (page: Page): Promise<string> =>
  page.evaluate(() => (window as unknown as { __lt26: { sim: { state: { phase: string } } } }).__lt26.sim.state.phase);

/**
 * Advances the sim from the page until `phase` is reached (or maxS of sim time elapses), in 0.1 s
 * steps (the sim clamps a frame to 0.1 s and sub-steps at 240 Hz). Returns the phase reached.
 */
export async function advanceUntil(page: Page, target: string, maxS = 12): Promise<string> {
  return page.evaluate(
    ({ target, maxS }) => {
      const sim = (window as unknown as { __lt26: { sim: { state: { phase: string }; update(dt: number): void } } })
        .__lt26.sim;
      for (let t = 0; t < maxS && sim.state.phase !== target; t += 0.1) sim.update(0.1);
      return sim.state.phase;
    },
    { target, maxS },
  );
}

/** The last shot summary, with the path reduced to its length (keeps the transfer small). */
export async function lastShot(page: Page): Promise<SummaryLite | null> {
  return page.evaluate(() => {
    const s = (
      window as unknown as {
        __lt26: { sim: { state: { lastShot: (Omit<SummaryLite, 'pathLength'> & { path: unknown[] }) | null } } };
      }
    ).__lt26.sim.state.lastShot;
    if (!s) return null;
    const { path, ...rest } = s;
    return { ...rest, pathLength: path.length };
  });
}

/** Sanity checks every kick summary must pass (numbers finite and physically plausible). */
export function expectSaneSummary(s: SummaryLite | null, opts: { maxKmh?: number } = {}): void {
  expect(s).not.toBeNull();
  const v = s as SummaryLite;
  for (const k of ['speedKmh', 'spinRps', 'lateralCurveM', 'apexM', 'timeToGoalS', 'missDistanceM'] as const) {
    expect(Number.isFinite(v[k]), `${k} = ${v[k]}`).toBe(true);
  }
  expect(v.speedKmh).toBeGreaterThanOrEqual(40 - 1e-6);
  expect(v.speedKmh).toBeLessThanOrEqual(opts.maxKmh ?? 115);
  expect(v.apexM).toBeGreaterThanOrEqual(0.11);
  expect(v.timeToGoalS).toBeGreaterThan(0);
  expect(v.pathLength).toBeGreaterThan(10);
}

/** One scripted kick through the live sim (window.__lt26.sim) of the running app. */
export interface KickSpec {
  mode: Mode;
  spot: string;
  /** Strike aim: world launch angles, or a point on the goal plane (as the dial produces). */
  aim: { kind: 'angles'; azimuth: number; elevation: number } | { kind: 'target'; x: number; y: number };
  power: number;
  sideSpin: number;
  topSpin: number;
  /** Penalty / long shot: strike this many ms after the ideal contact (negative = early). */
  timingMs?: number;
  /** Long shot: power of the first touch. */
  pushPower?: number;
  disguise?: boolean;
}

export interface KickOutcome {
  result: string;
  speedKmh: number;
  launchKmh: number;
  timingErrorMs: number;
  lateralCurveM: number;
  apexM: number;
  timeToGoalS: number;
  crossing: { x: number; y: number } | null;
  missDistanceM: number;
  pathLength: number;
  finite: boolean;
}

/**
 * Takes the kicks in the page, synchronously, on the sim clock: set mode/spot, run-up or push, advance to the
 * ideal contact + timingMs, apply the strike with atMs = sim time, advance until the result. Intended to be
 * called while the title screen is shown (the frame loop then does not advance the sim).
 */
export async function runKicks(page: Page, specs: KickSpec[]): Promise<KickOutcome[]> {
  return page.evaluate((list) => {
    type V = { x: number; y: number; z: number };
    interface SimLike {
      state: {
        mode: string;
        spotKey: string;
        phase: string;
        time: number;
        ball: { p: V };
        lastShot: {
          result: string;
          speedKmh: number;
          lateralCurveM: number;
          apexM: number;
          timeToGoalS: number;
          crossing: { x: number; y: number } | null;
          missDistanceM: number;
          path: V[];
        } | null;
      };
      setMode(m: string): void;
      setSpot(s: string): void;
      resetShot(): void;
      startRunUp(): number;
      applyIntent(i: unknown): void;
      update(dt: number): void;
      on(l: (e: { type: string; launch?: { speed: number }; timingErrorMs?: number }) => void): () => void;
    }
    const sim = (window as unknown as { __lt26: { sim: SimLike } }).__lt26.sim;
    const out: KickOutcome[] = [];
    const advanceTo = (t: number): void => {
      while (sim.state.time < t - 1e-9) sim.update(Math.min(0.1, t - sim.state.time + 1e-6));
    };
    for (const k of list) {
      if (sim.state.mode !== k.mode) sim.setMode(k.mode);
      if (sim.state.spotKey !== k.spot) sim.setSpot(k.spot);
      sim.resetShot();
      let kick: { speed: number; timingErrorMs: number } | null = null;
      const off = sim.on((e) => {
        if (e.type === 'kick') kick = { speed: e.launch!.speed, timingErrorMs: e.timingErrorMs! };
      });
      const strike = {
        kind: 'strike',
        scheme: k.aim.kind === 'target' ? 'dial' : 'swipe',
        aim: k.aim,
        power: k.power,
        sideSpin: k.sideSpin,
        topSpin: k.topSpin,
        disguise: k.disguise,
        atMs: 0,
      };
      if (k.mode === 'penalty') {
        const contact = sim.startRunUp();
        advanceTo(contact + (k.timingMs ?? 0) / 1000);
      } else if (k.mode === 'longShot') {
        const b = sim.state.ball.p;
        const az = Math.atan2(-b.x, b.z);
        sim.applyIntent({
          kind: 'push',
          scheme: 'swipe',
          aim: { kind: 'angles', azimuth: az, elevation: 0 },
          power: k.pushPower ?? 0.5,
          sideSpin: 0,
          topSpin: 0,
          atMs: sim.state.time * 1000,
        });
        const contact = sim.startRunUp();
        advanceTo(contact + (k.timingMs ?? 0) / 1000);
      }
      strike.atMs = sim.state.time * 1000;
      sim.applyIntent(strike);
      for (let t = 0; t < 12 && sim.state.phase !== 'result'; t += 0.1) sim.update(0.1);
      off();
      const s = sim.state.phase === 'result' ? sim.state.lastShot : null;
      const kk = kick as { speed: number; timingErrorMs: number } | null;
      const nums = s ? [s.speedKmh, s.lateralCurveM, s.apexM, s.timeToGoalS, s.missDistanceM] : [NaN];
      const pathOk = s ? s.path.every((p) => Number.isFinite(p.x + p.y + p.z)) : false;
      out.push({
        result: s ? s.result : `no-result(${sim.state.phase})`,
        speedKmh: s ? s.speedKmh : NaN,
        launchKmh: kk ? kk.speed * 3.6 : NaN,
        timingErrorMs: kk ? kk.timingErrorMs : NaN,
        lateralCurveM: s ? s.lateralCurveM : NaN,
        apexM: s ? s.apexM : NaN,
        timeToGoalS: s ? s.timeToGoalS : NaN,
        crossing: s ? s.crossing : null,
        missDistanceM: s ? s.missDistanceM : NaN,
        pathLength: s ? s.path.length : 0,
        finite: nums.every(Number.isFinite) && pathOk && kk !== null && Number.isFinite(kk.speed),
      });
    }
    return out;
  }, specs);
}

/** "goal: 17, saved: 3" style tally. */
export function tally(o: KickOutcome[]): Record<string, number> {
  const t: Record<string, number> = {};
  for (const k of o) t[k.result] = (t[k.result] ?? 0) + 1;
  return t;
}

/**
 * Freezes (true) or releases (false) the sim clock of the running app. While frozen, the frame loop's
 * sim.update calls do nothing, so a multi-event CDP gesture (each event waits for a headless frame, i.e.
 * up to 0.1 s of sim time) lands at a chosen sim time. Pointer timestamps are unaffected.
 */
export async function freezeSimClock(page: Page, frozen: boolean): Promise<void> {
  await page.evaluate((on) => {
    const w = window as unknown as {
      __qaUpdate?: (dt: number) => void;
      __lt26: { sim: { update(dt: number): void } };
    };
    const sim = w.__lt26.sim;
    if (on && !w.__qaUpdate) {
      w.__qaUpdate = sim.update.bind(sim);
      sim.update = () => undefined;
    } else if (!on && w.__qaUpdate) {
      sim.update = w.__qaUpdate;
      delete w.__qaUpdate;
    }
  }, frozen);
}

/** Advances the (unfrozen) sim to `offsetS` relative to the last runUpStart's contactAt, then freezes it. */
export async function runToContactAndFreeze(page: Page, offsetS: number): Promise<void> {
  await freezeSimClock(page, true);
  await page.evaluate((off) => {
    const w = window as unknown as {
      __qaUpdate: (dt: number) => void;
      __lt26: { sim: { state: { time: number } }; events: { type: string; contactAt?: number }[] };
    };
    const ev = w.__lt26.events.filter((e) => e.type === 'runUpStart').pop();
    if (!ev || ev.contactAt === undefined) throw new Error('no runUpStart event');
    const target = ev.contactAt + off;
    while (w.__lt26.sim.state.time < target - 1e-9)
      w.__qaUpdate(Math.min(0.02, target - w.__lt26.sim.state.time + 1e-6));
  }, offsetS);
}
