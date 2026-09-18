// Performance (brief §7.3): 300 frames of the free-kick scene (kick camera; wall, keeper, Talilei, ball)
// rendered through the real SceneApi. Records draw calls, triangles and mean frame time; gates on geometry
// only (headless SwiftShader timing is indicative): draw calls ≤ 40, triangles ≤ 80 k.
import { expect, test } from '@playwright/test';
import { openMode, seedSettings, stableBall, watchErrors } from './helpers/qa';

test.beforeEach(() => test.slow());

interface PerfRun {
  frames: number;
  maxCalls: number;
  maxTris: number;
  meanCalls: number;
  meanTris: number;
  meanMs: number;
  statsFrameMs: number;
  wall: number;
  flightFrames: number;
}

test('free-kick scene: 300 frames within the draw-call and triangle budget', async ({ page }, info) => {
  const errors = watchErrors(page);
  await seedSettings(page, { controlScheme: 'dial' });
  await openMode(page, 'freeKick', 'dial');
  await stableBall(page);
  const r = await page.evaluate((): PerfRun => {
    type W = { wall: unknown[] };
    const l = (
      window as unknown as {
        __lt26: {
          sim: {
            state: { world: W; phase: string; time: number };
            applyIntent(i: unknown): void;
            update(dt: number): void;
            resetShot(): void;
          };
          scene: {
            render(w: W, dt: number): void;
            setCamera(c: string): void;
            getStats(): { drawCalls: number; triangles: number; frameMs: number };
          };
        };
      }
    ).__lt26;
    const { sim, scene } = l;
    scene.setCamera('kick');
    let maxCalls = 0;
    let maxTris = 0;
    let sumCalls = 0;
    let sumTris = 0;
    let sumMs = 0;
    let flightFrames = 0;
    const wall = sim.state.world.wall.length;
    for (let f = 0; f < 300; f += 1) {
      // Frames 0–99 aiming (static scene), 100+ a curling kick in flight (trail, wall jump, keeper dive).
      if (f === 100) {
        sim.applyIntent({
          kind: 'strike',
          scheme: 'dial',
          aim: { kind: 'target', x: -3.0, y: 2.1 },
          power: 0.6,
          sideSpin: 8,
          topSpin: 0,
          atMs: sim.state.time * 1000,
        });
      }
      if (f >= 100) {
        sim.update(1 / 60);
        if (sim.state.phase === 'flight') flightFrames += 1;
      }
      const t0 = performance.now();
      scene.render(sim.state.world, 1 / 60);
      const s = scene.getStats();
      sumMs += performance.now() - t0;
      maxCalls = Math.max(maxCalls, s.drawCalls);
      maxTris = Math.max(maxTris, s.triangles);
      sumCalls += s.drawCalls;
      sumTris += s.triangles;
    }
    return {
      frames: 300,
      maxCalls,
      maxTris,
      meanCalls: sumCalls / 300,
      meanTris: sumTris / 300,
      meanMs: sumMs / 300,
      statsFrameMs: scene.getStats().frameMs,
      wall,
      flightFrames,
    };
  });
  const line =
    `[qa-perf] ${info.project.name}: ${r.frames} frames, draw calls max ${r.maxCalls} (mean ${r.meanCalls.toFixed(1)}), ` +
    `triangles max ${r.maxTris} (mean ${Math.round(r.meanTris)}), mean render ${r.meanMs.toFixed(1)} ms ` +
    `(scene frameMs ${r.statsFrameMs.toFixed(1)}), wall ${r.wall}, flight frames ${r.flightFrames}`;
  console.log(line);
  info.annotations.push({ type: 'perf', description: line });
  expect(r.wall).toBeGreaterThanOrEqual(3);
  expect(r.flightFrames).toBeGreaterThan(20);
  expect(r.maxCalls).toBeGreaterThan(0);
  expect(r.maxCalls).toBeLessThanOrEqual(40);
  expect(r.maxTris).toBeLessThanOrEqual(80_000);
  expect(errors).toEqual([]);
});
