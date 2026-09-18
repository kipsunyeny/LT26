// Scripted outcome distributions through the running app (brief §6 Phase 2): 20 kicks per mode with varied
// inputs, driven through window.__lt26.sim on the sim clock (docs/ARCHITECTURE.md §3 sim timing).
// The app's seed is Date.now(), so every run samples fresh keeper reactions, scatter and knuckle noise.
import { expect, test, type Page } from '@playwright/test';
import { runKicks, tally, watchErrors, type KickOutcome, type KickSpec } from './helpers/qa';

test.beforeEach(() => test.slow());

async function boot(page: Page): Promise<string[]> {
  const errors = watchErrors(page);
  await page.goto('./');
  await page.waitForFunction(() => '__lt26' in window);
  // Stay on the title screen: the frame loop only advances the sim on the play screen.
  expect(await page.evaluate(() => (window as unknown as { __lt26: { screen(): string } }).__lt26.screen())).toBe(
    'title',
  );
  return errors;
}

const pick = <T>(xs: readonly T[], i: number): T => xs[i % xs.length];

function report(label: string, o: KickOutcome[]): void {
  console.log(`[qa-dist] ${label}: ${JSON.stringify(tally(o))}`);
}

test('penalties: low corners at 85 % score ≥ 80 %; central mid-height ≤ 20 %', async ({ page }) => {
  const errors = await boot(page);
  const corner: KickSpec[] = Array.from({ length: 20 }, (_, i) => ({
    mode: 'penalty',
    spot: 'pk-spot',
    aim: { kind: 'target', x: (i % 2 ? 1 : -1) * pick([3.0, 3.1, 2.9, 3.2], i >> 1), y: pick([0.25, 0.35, 0.3], i) },
    power: 0.85,
    sideSpin: pick([0, 0, 1, -1], i),
    topSpin: 0,
    timingMs: pick([0, 30, -40, 60, -70], i),
    disguise: i % 5 === 0,
  }));
  const central: KickSpec[] = Array.from({ length: 20 }, (_, i) => ({
    mode: 'penalty',
    spot: 'pk-spot',
    aim: { kind: 'target', x: pick([0, 0.3, -0.3, 0.15, -0.15], i), y: pick([1.0, 1.2, 1.4], i) },
    power: pick([0.55, 0.7, 0.85], i),
    sideSpin: 0,
    topSpin: 0,
    timingMs: pick([0, 40, -40], i),
  }));
  const c = await runKicks(page, corner);
  const m = await runKicks(page, central);
  report('penalty low corner 85%', c);
  report('penalty central mid-height', m);
  expect(c.every((k) => k.finite)).toBe(true);
  expect(m.every((k) => k.finite)).toBe(true);
  const cg = c.filter((k) => k.result === 'goal').length;
  const mg = m.filter((k) => k.result === 'goal').length;
  expect(cg, `corner goals ${cg}/20`).toBeGreaterThanOrEqual(16);
  expect(mg, `central goals ${mg}/20`).toBeLessThanOrEqual(4);
  expect(errors).toEqual([]);
});

const FK_SPOTS = [
  { key: 'fk-centre', x: 0, z: 22 },
  { key: 'fk-left-d', x: -6, z: 18.5 },
  { key: 'fk-right-d', x: 6, z: 18.5 },
  { key: 'fk-wide-left', x: -15, z: 18.5 },
  { key: 'fk-wide-right', x: 15, z: 18.5 },
];

test('free kicks: from every preset spot the aim-assist finds a repeatable curling goal', async ({ page }) => {
  test.setTimeout(600_000);
  const errors = await boot(page);
  const found: Record<string, string> = {};
  const all: KickOutcome[] = [];
  for (const spot of FK_SPOTS) {
    // Candidates: both upper corners, speeds, both spin directions (strongest bend first), a little top spin.
    const cands: { x: number; y: number; kmh: number; side: number; top: number }[] = [];
    for (const side of [9, -9, 6, -6])
      for (const x of [3.3, -3.3, 3.0, -3.0])
        for (const y of [2.2, 1.9])
          for (const kmh of [75, 85, 95, 105]) for (const top of [0, 2]) cands.push({ x, y, kmh, side, top });
    let hit: string | null = null;
    let tried = 0;
    for (let i = 0; i < cands.length && !hit && tried < cands.length; i += 1) {
      const c = cands[i];
      await page.evaluate((k) => {
        const sim = (window as unknown as { __lt26: { sim: { setMode(m: string): void; setSpot(s: string): void } } })
          .__lt26.sim;
        sim.setMode('freeKick');
        sim.setSpot(k);
      }, spot.key);
      const launch = await page.evaluate(
        (c) =>
          (
            window as unknown as {
              __lt26: {
                sim: {
                  solveAim(
                    t: { x: number; y: number },
                    kmh: number,
                    s: number,
                    tp: number,
                  ): {
                    azimuth: number;
                    elevation: number;
                  } | null;
                };
              };
            }
          ).__lt26.sim.solveAim({ x: c.x, y: c.y }, c.kmh, c.side, c.top),
        c,
      );
      if (!launch) continue;
      tried += 1;
      const spec: KickSpec = {
        mode: 'freeKick',
        spot: spot.key,
        aim: { kind: 'angles', azimuth: launch.azimuth, elevation: launch.elevation },
        power: (c.kmh - 40) / 75,
        sideSpin: c.side,
        topSpin: c.top,
      };
      const [first] = await runKicks(page, [spec]);
      all.push(first);
      if (first.result !== 'goal' || first.lateralCurveM < 0.5) continue;
      const again = await runKicks(page, [spec, spec, spec]);
      all.push(...again);
      const goals = again.filter((k) => k.result === 'goal').length;
      if (goals >= 2)
        hit = `target (${c.x}, ${c.y}) ${c.kmh} km/h side ${c.side} top ${c.top} → curve ${first.lateralCurveM.toFixed(2)} m, repeats ${goals}/3 (after ${tried} candidates)`;
    }
    found[spot.key] = hit ?? `none in ${tried} solvable candidates`;
    console.log(`[qa-dist] free kick ${spot.key}: ${found[spot.key]}`);
  }
  report('free kick search, all kicks', all);
  expect(all.every((k) => k.finite)).toBe(true);
  for (const spot of FK_SPOTS) expect(found[spot.key], spot.key).toMatch(/repeats/);
  expect(errors).toEqual([]);
});

test('long shots (10 varied + 10 placed): a sane mix of outcomes, no NaNs; a > 200 ms timing error costs speed', async ({
  page,
}) => {
  const errors = await boot(page);
  const specs: KickSpec[] = Array.from({ length: 10 }, (_, i) => ({
    mode: 'longShot',
    spot: pick(['ls-centre', 'ls-left', 'ls-right'], i),
    aim: { kind: 'target', x: pick([-3.0, 2.8, -1.5, 0.5, 3.4, -2.2, 1.8], i), y: pick([0.6, 1.9, 1.2, 2.2, 0.4], i) },
    power: pick([0.6, 0.75, 0.85, 0.7], i),
    sideSpin: pick([0, 4, -4, 7, -7], i),
    topSpin: pick([0, 3, 0, -1], i),
    timingMs: pick([0, 50, -60, 150, -250, 20, 300], i),
    pushPower: pick([0.3, 0.5, 0.7], i),
  }));
  const o = await runKicks(page, specs);
  report('long shot mix', o);
  console.log(
    `[qa-dist] long shot kicks: ${o.map((k) => `${k.result}@${k.launchKmh.toFixed(0)}km/h/${k.timingErrorMs.toFixed(0)}ms`).join(' ')}`,
  );
  expect(o.every((k) => k.finite)).toBe(true);

  // Well-placed: the far corner from the closing defender (he closes on the kicker's right unless the ball is
  // right of centre), perfect timing, the longest (still short, ≈5 m) push.
  const placed: KickSpec[] = Array.from({ length: 10 }, (_, i) => {
    const spot = pick(['ls-centre', 'ls-left', 'ls-right'], i);
    return {
      mode: 'longShot',
      spot,
      aim: { kind: 'target', x: spot === 'ls-right' ? 3.3 : -3.3, y: pick([0.3, 2.1], i >> 1) },
      power: 0.8,
      sideSpin: 0,
      topSpin: 0,
      timingMs: 0,
      pushPower: 1,
    };
  });
  const po = await runKicks(page, placed);
  report('long shot well-placed corners', po);
  expect(po.every((k) => k.finite)).toBe(true);
  expect(po.filter((k) => k.result === 'goal').length, 'placed corner goals').toBeGreaterThanOrEqual(5);
  // The 20 kicks together: a sane mix.
  const all = [...o, ...po];
  report('long shot, all 20', all);
  const goals = all.filter((k) => k.result === 'goal').length;
  expect(goals, 'some goals').toBeGreaterThanOrEqual(3);
  expect(20 - goals, 'some saves / misses').toBeGreaterThanOrEqual(3);
  for (const [k, s] of o.map((k, i) => [k, specs[i]] as const))
    expect(Math.abs(k.timingErrorMs - (s.timingMs ?? 0))).toBeLessThanOrEqual(5);

  // Same strike, ideal timing vs 250 ms late (both scatter-free apart from the timing σ).
  const base: KickSpec = {
    mode: 'longShot',
    spot: 'ls-centre',
    aim: { kind: 'target', x: 1.5, y: 1.2 },
    power: 0.8,
    sideSpin: 0,
    topSpin: 0,
    pushPower: 0.5,
  };
  const pairs = await runKicks(page, [
    { ...base, timingMs: 0 },
    { ...base, timingMs: 250 },
    { ...base, timingMs: -250 },
  ]);
  console.log(
    `[qa-dist] long shot timing: ${pairs.map((k) => `${k.timingErrorMs.toFixed(0)} ms → ${k.launchKmh.toFixed(1)} km/h`).join(', ')}`,
  );
  expect(pairs[1].launchKmh).toBeLessThan(pairs[0].launchKmh - 5);
  expect(pairs[2].launchKmh).toBeLessThan(pairs[0].launchKmh - 5);
  expect(errors).toEqual([]);
});
