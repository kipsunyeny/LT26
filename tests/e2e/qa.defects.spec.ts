// Tests that document open defects (docs/qa/DEFECTS.md). They fail until the product is fixed.
import { expect, test } from '@playwright/test';
import { openMode, runKicks, seedSettings, stableBall, tally, watchErrors, type KickSpec } from './helpers/qa';

test.beforeEach(() => test.slow());

test('D-1: free-kick spot buttons keep their label on one line at 1280×800', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await seedSettings(page, { controlScheme: 'swipe' });
  await openMode(page, 'freeKick', 'swipe');
  const lines = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.spot-grid .spot')].map((b) => {
      const r = document.createRange();
      r.selectNodeContents(b);
      const tops = new Set([...r.getClientRects()].map((q) => Math.round(q.top)));
      return `${b.textContent}: ${tops.size}`;
    }),
  );
  expect(lines.length).toBe(5);
  expect(lines).toEqual(['Centre: 1', 'Left D: 1', 'Right D: 1', 'Wide L: 1', 'Wide R: 1']);
});

test('D-2: a long shot blocked by the closing defender is not reported as "Blocked by the wall"', async ({ page }) => {
  const errors = watchErrors(page);
  await seedSettings(page, { controlScheme: 'dial' });
  await openMode(page, 'longShot', 'dial');
  await stableBall(page);
  // Search push power × target (whole kicks on the sim clock) until the closing defender blocks one; the
  // last kick is then the blocked one and its card is shown.
  const tags = await page.evaluate(() => {
    const l = (
      window as unknown as {
        __lt26: {
          sim: {
            state: { time: number; phase: string; ball: { p: { x: number; z: number } } };
            applyIntent(i: unknown): void;
            startRunUp(): number;
            resetShot(): void;
            update(dt: number): void;
            on(f: (e: { type: string; contact?: { tag: string } }) => void): () => void;
          };
        };
      }
    ).__lt26;
    const sim = l.sim;
    let seen: string[] = [];
    const off = sim.on((e) => {
      if (e.type === 'contact' && e.contact) seen.push(e.contact.tag);
    });
    outer: for (const pushPower of [0.5, 0.2, 0.8, 1, 0]) {
      for (const x of [3.3, 2.2, 1.1, 0, -1.1, -2.2, -3.3]) {
        for (const y of [0.3, 1.0]) {
          sim.resetShot();
          seen = [];
          const b = sim.state.ball.p;
          sim.applyIntent({
            kind: 'push',
            scheme: 'dial',
            aim: { kind: 'angles', azimuth: Math.atan2(-b.x, b.z), elevation: 0 },
            power: pushPower,
            sideSpin: 0,
            topSpin: 0,
            atMs: sim.state.time * 1000,
          });
          const c = sim.startRunUp();
          while (sim.state.time < c) sim.update(Math.min(0.1, c - sim.state.time + 1e-6));
          sim.applyIntent({
            kind: 'strike',
            scheme: 'dial',
            aim: { kind: 'target', x, y },
            power: 0.8,
            sideSpin: 0,
            topSpin: 0,
            atMs: sim.state.time * 1000,
          });
          for (let t = 0; t < 12 && sim.state.phase !== 'result'; t += 0.1) sim.update(0.1);
          if (seen.includes('defender')) break outer;
        }
      }
    }
    off();
    return seen;
  });
  expect(tags).toContain('defender');
  expect(tags).not.toContain('wall');
  await expect(page.getByTestId('shot-card')).toBeVisible();
  await expect(page.getByTestId('shot-result')).not.toHaveText(/wall/i);
  expect(errors).toEqual([]);
});

test('D-3: perfectly timed long shots into the corner areas score at least 1 in 4', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./');
  await page.waitForFunction(() => '__lt26' in window);
  const specs: KickSpec[] = [];
  for (const spot of ['ls-centre', 'ls-left', 'ls-right'])
    for (const x of [-3.3, -3.0, 3.0, 3.3])
      for (const y of [0.3, 2.1])
        specs.push({
          mode: 'longShot',
          spot,
          aim: { kind: 'target', x, y },
          power: 0.8,
          sideSpin: 0,
          topSpin: 0,
          timingMs: 0,
          pushPower: 0.5,
        });
  const o = await runKicks(page, specs);
  const t = tally(o);
  console.log(`[qa-defect] D-3 long-shot corner areas, push 0.5, 94 km/h, perfect timing: ${JSON.stringify(t)}`);
  expect(o.every((k) => k.finite)).toBe(true);
  expect(t.goal ?? 0, JSON.stringify(t)).toBeGreaterThanOrEqual(6);
  expect(errors).toEqual([]);
});
