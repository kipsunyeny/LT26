// Brief §6 Phase 2 outcome distributions, on seeded sims.
import { describe, expect, it } from 'vitest';
import { SPOTS } from '../../src/data/presets';
import { newSim, penalty, runToResult, strike } from './sim.helpers';

const SEEDS = Array.from({ length: 24 }, (_, i) => i + 1);

function goalRate(target: { x: number; y: number }, power: number): number {
  let goals = 0;
  for (const seed of SEEDS) {
    const { sim } = penalty(seed, target, power);
    runToResult(sim);
    if (sim.state.lastShot?.result === 'goal') goals++;
  }
  return goals / SEEDS.length;
}

describe('penalty outcome distribution (24 seeds each, 85 % power, perfect timing)', () => {
  it('well-placed low corner (±3.0, 0.3) scores ≥ 80 %', () => {
    const right = goalRate({ x: 3.0, y: 0.3 }, 0.85);
    const left = goalRate({ x: -3.0, y: 0.3 }, 0.85);
    console.log(
      `[outcomes] penalty low corner goal rate: right ${(right * 100).toFixed(0)} %, left ${(left * 100).toFixed(0)} %`,
    );
    expect(right).toBeGreaterThanOrEqual(0.8);
    expect(left).toBeGreaterThanOrEqual(0.8);
  });

  it('central mid-height (0, 1.2) scores ≤ 20 %', () => {
    const r = goalRate({ x: 0, y: 1.2 }, 0.85);
    console.log(`[outcomes] penalty central mid-height goal rate: ${(r * 100).toFixed(0)} %`);
    expect(r).toBeLessThanOrEqual(0.2);
  });
});

describe('free kicks: a repeatable curling goal exists from every preset spot', () => {
  for (const spot of SPOTS.freeKick) {
    it(`${spot.key}`, () => {
      const near = spot.ball.x > 0.5 ? 1 : -1;
      const seed = 11;
      let found: { tx: number; ty: number; side: number; top: number; power: number } | null = null;
      search: for (const ty of [2.15, 1.95])
        for (const tx of [near * 3.25, near * 3.0, -near * 3.25])
          for (const top of [3, 0])
            for (const power of [0.55, 0.62, 0.7])
              for (const side of [-8, -5, 5, 8]) {
                const { sim } = newSim(seed);
                sim.setMode('freeKick');
                sim.setSpot(spot.key);
                if (!sim.solveAim({ x: tx, y: ty }, 40 + 75 * power, side, top)) continue;
                sim.applyIntent(strike({ kind: 'target', x: tx, y: ty }, power, side, top));
                runToResult(sim);
                if (sim.state.lastShot?.result === 'goal') {
                  found = { tx, ty, side, top, power };
                  break search;
                }
              }
      console.log(`[outcomes] ${spot.key} curling goal: ${JSON.stringify(found)}`);
      expect(found).not.toBeNull();
      if (!found) return;
      // Replay the same intent with the same seed: same goal, same path.
      const runs = [0, 1].map(() => {
        const { sim } = newSim(seed);
        sim.setMode('freeKick');
        sim.setSpot(spot.key);
        const f = found as NonNullable<typeof found>;
        sim.applyIntent(strike({ kind: 'target', x: f.tx, y: f.ty }, f.power, f.side, f.top));
        runToResult(sim);
        return sim.state.lastShot;
      });
      expect(runs[0]?.result).toBe('goal');
      expect(runs[1]).toEqual(runs[0]);
    }, 60000);
  }
});

describe('long shot outcome distribution (push 0.5, 94 km/h, perfect timing, no spin)', () => {
  function longShots(xs: number[], ys: number[], pushPower = 0.5) {
    const { sim, events } = newSim(1);
    sim.setMode('longShot');
    const tally: Record<string, number> = {};
    const defDist: number[] = [];
    for (const spot of ['ls-centre', 'ls-left', 'ls-right'])
      for (const x of xs)
        for (const y of ys) {
          sim.setSpot(spot);
          sim.resetShot();
          events.length = 0;
          const b = sim.state.ball.p;
          sim.applyIntent({
            kind: 'push',
            scheme: 'swipe',
            aim: { kind: 'angles', azimuth: Math.atan2(-b.x, b.z), elevation: 0 },
            power: pushPower,
            sideSpin: 0,
            topSpin: 0,
            atMs: sim.state.time * 1000,
          });
          const c = sim.startRunUp();
          while (sim.state.time < c - 1e-9) sim.update(1 / 240);
          const d = sim.state.world.defender?.p;
          const p = sim.state.ball.p;
          if (d) defDist.push(Math.hypot(d.x - p.x, d.z - p.z));
          sim.applyIntent(strike({ kind: 'target', x, y }, 0.8, 0, 0, sim.state.time * 1000));
          runToResult(sim);
          const r = sim.state.lastShot?.result ?? 'none';
          tally[r] = (tally[r] ?? 0) + 1;
        }
    return { tally, defDist };
  }

  it('corner areas (x ±3.0/±3.3, y 0.3/2.1) score at least 1 in 4 (QA D-3 grid)', () => {
    const { tally, defDist } = longShots([-3.3, -3.0, 3.0, 3.3], [0.3, 2.1]);
    console.log(
      `[outcomes] long-shot corners: ${JSON.stringify(tally)}; defender at strike ${Math.min(...defDist).toFixed(1)}–${Math.max(...defDist).toFixed(1)} m`,
    );
    expect(tally.goal ?? 0).toBeGreaterThanOrEqual(6);
    expect(tally.goal ?? 0).toBeLessThan(24);
    for (const d of defDist) {
      expect(d).toBeGreaterThanOrEqual(3.5);
      expect(d).toBeLessThanOrEqual(6.5);
    }
  });

  it('central shots are saved or blocked', () => {
    const { tally } = longShots([-1.5, 0, 1.5], [0.5, 1.2]);
    console.log(`[outcomes] long-shot central: ${JSON.stringify(tally)}`);
    expect(tally.goal ?? 0).toBeLessThanOrEqual(3);
    expect(tally.wall ?? 0).toBeGreaterThan(0);
  });
});
