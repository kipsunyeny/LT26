import { describe, expect, it } from 'vitest';
import type { PhysicsEnv, Vec3 } from '../../src/contracts';
import { simulate, solveLaunch } from '../../src/physics';

const SEA: PhysicsEnv = { rho: 1.2, seed: 11 };
const NBO: PhysicsEnv = { rho: 0.99, seed: 11 };
const ORIGIN: Vec3 = { x: 0, y: 0.11, z: 22 };

function landing(l: NonNullable<ReturnType<typeof solveLaunch>>, env: PhysicsEnv): { x: number; y: number } {
  const c = simulate(l, env, { stopAtGoalLine: true }).lineCrossing;
  if (!c) throw new Error('solved launch does not cross the line');
  return { x: c.p.x, y: c.p.y };
}

describe('solveLaunch', () => {
  const targets = [
    { x: 3.0, y: 2.0 },
    { x: -3.0, y: 2.0 },
    { x: 0, y: 1.0 },
    { x: -2.5, y: 0.4 },
  ];

  for (const env of [SEA, NBO]) {
    it(`hits goal-face targets within 5 cm from 22 m, 90–110 km/h, −8…+8 rev/s (ρ = ${env.rho})`, () => {
      let worst = 0;
      for (const target of targets)
        for (const kmh of [90, 100, 110])
          for (const side of [-8, 0, 8]) {
            const l = solveLaunch(ORIGIN, target, kmh / 3.6, side, 0, env);
            expect(l, `target ${JSON.stringify(target)} ${kmh} km/h side ${side}`).not.toBeNull();
            if (!l) continue;
            expect(l.origin).toEqual(ORIGIN);
            expect(l.speed).toBeCloseTo(kmh / 3.6, 12);
            expect(l.sideSpin).toBe(side);
            const hit = landing(l, env);
            const err = Math.hypot(hit.x - target.x, hit.y - target.y);
            worst = Math.max(worst, err);
            expect(err).toBeLessThan(0.05);
          }
      console.log(`[physics-solver] rho=${env.rho} worst miss ${(worst * 100).toFixed(2)} cm`);
    });
  }

  it('handles top/back spin and an off-centre origin', () => {
    const origin = { x: -8, y: 0.11, z: 18 };
    for (const top of [-4, 4]) {
      const l = solveLaunch(origin, { x: 2.8, y: 2.1 }, 27, -6, top, SEA);
      expect(l).not.toBeNull();
      if (!l) continue;
      const hit = landing(l, SEA);
      expect(Math.hypot(hit.x - 2.8, hit.y - 2.1)).toBeLessThan(0.05);
    }
  });

  it('returns null for unreachable targets', () => {
    expect(solveLaunch({ x: 0, y: 0.11, z: 35 }, { x: 3.4, y: 2.2 }, 40 / 3.6, 0, 0, SEA)).toBeNull();
    expect(solveLaunch({ x: 0, y: 0.11, z: 30 }, { x: 0, y: 30 }, 60 / 3.6, 0, 0, SEA)).toBeNull();
  });

  it('is fast enough for a per-frame aim preview (median < 8 ms per solve even on a loaded CI machine)', () => {
    const cases: [number, number, number][] = [
      [3.0, 2.0, 8],
      [-3.0, 2.0, -8],
      [0, 1.0, 0],
      [-2.5, 0.4, 4],
      [1.5, 1.8, -4],
    ];
    for (const [x, y, s] of cases) solveLaunch(ORIGIN, { x, y }, 27, s, 0, SEA);
    const times: number[] = [];
    for (let rep = 0; rep < 8; rep++)
      for (const [x, y, s] of cases) {
        const t0 = performance.now();
        solveLaunch(ORIGIN, { x, y }, 27 + rep * 0.2, s, 0, SEA);
        times.push(performance.now() - t0);
      }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)];
    console.log(
      `[physics-solver] solve time median ${median.toFixed(3)} ms, max ${times[times.length - 1].toFixed(3)} ms`,
    );
    expect(median).toBeLessThan(8);
  });
});
