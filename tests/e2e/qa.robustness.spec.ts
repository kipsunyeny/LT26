// Robustness probes: mode switch mid-flight, rapid Next/Replay, resize mid-play, left-footed setting,
// and the altitude setting changing the bend (sim-level check through the running app).
import { expect, test, type Page } from '@playwright/test';
import {
  advanceUntil,
  eventTypes,
  intentCount,
  openMode,
  phase,
  seedSettings,
  stableBall,
  watchErrors,
} from './helpers/qa';

test.beforeEach(() => test.slow());

/** Dial free kick via the real Shoot button (power bar tap first). */
async function dialShoot(page: Page, pct = 0.7): Promise<void> {
  const bar = (await page.getByTestId('power-bar').boundingBox())!;
  await page.mouse.click(bar.x + bar.width * pct, bar.y + bar.height / 2);
  await page.getByTestId('btn-shoot').click();
}

const simMode = (page: Page): Promise<string> =>
  page.evaluate(() => (window as unknown as { __lt26: { sim: { state: { mode: string } } } }).__lt26.sim.state.mode);

test('switching mode while the ball is in flight abandons the kick cleanly', async ({ page }) => {
  const errors = watchErrors(page);
  await seedSettings(page, { controlScheme: 'dial' });
  await openMode(page, 'freeKick', 'dial');
  await stableBall(page);
  await dialShoot(page);
  await expect.poll(() => phase(page)).toBe('flight');
  const resultsBefore = (await eventTypes(page)).filter((t) => t === 'result').length;
  await page.getByTestId('tab-penalty').click();
  expect(await simMode(page)).toBe('penalty');
  expect(await phase(page)).toBe('aiming');
  // Keep running: the abandoned free kick must not produce a result or a shot card.
  await page.evaluate(() => {
    const sim = (window as unknown as { __lt26: { sim: { update(dt: number): void } } }).__lt26.sim;
    for (let i = 0; i < 40; i += 1) sim.update(0.1);
  });
  expect((await eventTypes(page)).filter((t) => t === 'result').length).toBe(resultsBefore);
  await expect(page.getByTestId('shot-card')).toHaveCount(0);
  const ball = await page.evaluate(() => {
    const s = (window as unknown as { __lt26: { sim: { state: { ball: { p: { z: number } }; phase: string } } } })
      .__lt26.sim.state;
    return { z: s.ball.p.z, phase: s.phase };
  });
  expect(ball).toEqual({ z: 11, phase: 'aiming' });
  // The new mode still plays.
  const s = (await page.getByTestId('btn-shoot').boundingBox())!;
  await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(300);
  await page.mouse.up();
  await expect.poll(() => intentCount(page)).toBe(2);
  expect(await advanceUntil(page, 'result')).toBe('result');
  await expect(page.getByTestId('shot-card')).toBeVisible();
  expect(errors).toEqual([]);
});

test('pressing Replay / Back / Next quickly leaves a playable, consistent state', async ({ page }) => {
  const errors = watchErrors(page);
  await seedSettings(page, { controlScheme: 'dial' });
  await openMode(page, 'freeKick', 'dial');
  await stableBall(page);
  await dialShoot(page);
  expect(await advanceUntil(page, 'result')).toBe('result');
  await expect(page.getByTestId('shot-card')).toBeVisible();
  for (let i = 0; i < 3; i += 1) {
    await page.getByTestId('btn-replay').click();
    await page.getByTestId('btn-back').click();
  }
  await page.getByTestId('btn-next').dblclick();
  await expect(page.getByTestId('shot-card')).toHaveCount(0);
  expect(await phase(page)).toBe('aiming');
  // Next kick works and is logged once per kick.
  await dialShoot(page, 0.6);
  expect(await advanceUntil(page, 'result')).toBe('result');
  await expect(page.getByTestId('shot-card')).toBeVisible();
  const attempts = await page.evaluate(() => {
    const raw = localStorage.getItem('lt26.log.v1') ?? '';
    const m = /"attempts":(\d+)/.exec(raw);
    return m ? Number(m[1]) : -1;
  });
  expect(attempts).toBe(2);
  expect(errors).toEqual([]);
});

test('resizing mid-flight keeps the ball on screen and the kick completes', async ({ page }) => {
  const errors = watchErrors(page);
  await seedSettings(page, { controlScheme: 'dial' });
  await openMode(page, 'freeKick', 'dial');
  await stableBall(page);
  await dialShoot(page);
  await expect.poll(() => phase(page)).toBe('flight');
  await page.setViewportSize({ width: 1000, height: 640 });
  await page.waitForTimeout(500);
  await page.setViewportSize({ width: 1280, height: 800 });
  expect(await advanceUntil(page, 'result')).toBe('result');
  await expect(page.getByTestId('shot-card')).toBeVisible();
  await page.getByTestId('btn-next').click();
  await page.setViewportSize({ width: 1024, height: 700 });
  const b = await stableBall(page);
  expect(b.x).toBeGreaterThan(0);
  expect(b.x).toBeLessThan(1024);
  expect(b.y).toBeLessThan(700);
  // The canvas follows the viewport.
  const canvas = await page.locator('#scene').boundingBox();
  expect(Math.round(canvas!.width)).toBe(1024);
  expect(Math.round(canvas!.height)).toBe(700);
  expect(errors).toEqual([]);
});

test('left-footed: Talilei stands on the other side; the physics curve sign is unchanged', async ({ page }) => {
  const errors = watchErrors(page);
  const side = async (): Promise<{ taker: number; ball: number; curveX: number }> =>
    page.evaluate(() => {
      const sim = (
        window as unknown as {
          __lt26: {
            sim: {
              state: { world: { taker: { p: { x: number } }; ball: { p: { x: number } } } };
              previewPath(i: unknown): { x: number; z: number }[];
            };
          };
        }
      ).__lt26.sim;
      const path = sim.previewPath({
        kind: 'strike',
        scheme: 'swipe',
        aim: { kind: 'angles', azimuth: 0, elevation: 0.2 },
        power: 0.6,
        sideSpin: 8,
        topSpin: 0,
        atMs: 0,
      });
      const near = path.reduce((a, p) => (Math.abs(p.z) < Math.abs(a.z) ? p : a));
      return { taker: sim.state.world.taker.p.x, ball: sim.state.world.ball.p.x, curveX: near.x };
    });
  await seedSettings(page, { controlScheme: 'dial', footed: 'right' });
  await openMode(page, 'penalty', 'dial');
  const right = await side();
  await page.getByTestId('btn-back').click();
  await page.getByTestId('btn-settings').click();
  await page.getByTestId('setting-footed').selectOption('left');
  await page.getByTestId('btn-back').click();
  await page.getByTestId('btn-mode-penalty').click();
  const left = await side();
  expect(right.taker).toBeLessThan(right.ball);
  expect(left.taker).toBeGreaterThan(left.ball);
  // + side spin curves to +x for both feet (labels mirror, physics does not).
  expect(right.curveX).toBeGreaterThan(0.2);
  expect(left.curveX).toBeCloseTo(right.curveX, 3);
  expect(errors).toEqual([]);
});

test('altitude switch: the same curling free kick bends 12–20 % less in Nairobi air', async ({ page }) => {
  const errors = watchErrors(page);
  const bend = async (): Promise<number> =>
    page.evaluate(() => {
      const sim = (
        window as unknown as {
          __lt26: {
            sim: {
              setSpot(s: string): void;
              previewPath(i: unknown): { x: number; z: number }[];
            };
          };
        }
      ).__lt26.sim;
      sim.setSpot('fk-centre');
      const mk = (sideSpin: number) =>
        sim.previewPath({
          kind: 'strike',
          scheme: 'swipe',
          aim: { kind: 'angles', azimuth: 0, elevation: (6 * Math.PI) / 180 },
          power: (100 - 40) / 75,
          sideSpin,
          topSpin: 0,
          atMs: 0,
        });
      const xAtLine = (p: { x: number; z: number }[]): number => {
        for (let i = 1; i < p.length; i += 1) {
          if (p[i - 1].z >= 0 && p[i].z < 0) {
            const u = p[i - 1].z / (p[i - 1].z - p[i].z);
            return p[i - 1].x + (p[i].x - p[i - 1].x) * u;
          }
        }
        return NaN;
      };
      return xAtLine(mk(8)) - xAtLine(mk(0));
    });
  await seedSettings(page, { controlScheme: 'dial', altitude: 'sea' });
  await openMode(page, 'freeKick', 'dial');
  const sea = await bend();
  await page.getByTestId('btn-back').click();
  await page.getByTestId('btn-settings').click();
  await page.getByTestId('setting-altitude').selectOption('nairobi');
  await page.getByTestId('btn-back').click();
  await page.getByTestId('btn-mode-freeKick').click();
  const nbo = await bend();
  console.log(
    `[qa-robust] bend at the line: sea ${sea.toFixed(3)} m, Nairobi ${nbo.toFixed(3)} m, ratio ${(nbo / sea).toFixed(3)}`,
  );
  expect(sea).toBeGreaterThan(1.5);
  expect(nbo / sea).toBeGreaterThanOrEqual(0.8);
  expect(nbo / sea).toBeLessThanOrEqual(0.88);
  expect(errors).toEqual([]);
});
