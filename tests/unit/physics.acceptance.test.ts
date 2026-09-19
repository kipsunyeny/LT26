/**
 * LT26 physics acceptance tests — one `it` per row of LT26-BUILD-PROMPT.md §4, with the brief's bounds.
 *
 * Measurement definitions (orchestrator brief):
 *  - Kicks start at origin (0, 0.11, d) with azimuth 0, so the lateral deviation from the launch line at the
 *    goal line is |x| of the interpolated crossing of z = 0 (Trajectory.lineCrossing).
 *  - Time of flight = crossing time; arrival speed = |v| at the crossing, in km/h.
 *  - No colliders; sea level ρ = 1.20 unless the row says otherwise.
 *  - Free flight: the ground plane is switched off (`ground: false`). Several rows' launches pass below y = 0
 *    before the line (e.g. 6° from 25 m crosses ≈ 2 m below ground), so the table can only describe free flight.
 */
import { describe, expect, it } from 'vitest';
import type { LaunchParams, PhysicsEnv, Trajectory, Vec3 } from '../../src/contracts';
import { simulate } from '../../src/physics';

const KMH = 1 / 3.6;
const DEG = Math.PI / 180;
const SEA: PhysicsEnv = { rho: 1.2, seed: 2026 };

function kick(d: number, kmh: number, elevDeg: number, sideSpin = 0, topSpin = 0): LaunchParams {
  return {
    origin: { x: 0, y: 0.11, z: d },
    speed: kmh * KMH,
    azimuth: 0,
    elevation: elevDeg * DEG,
    sideSpin,
    topSpin,
  };
}

const len = (v: Vec3): number => Math.hypot(v.x, v.y, v.z);

interface Crossing {
  t: number;
  x: number;
  y: number;
  kmh: number;
}

function cross(l: LaunchParams, env: PhysicsEnv = SEA): Crossing {
  const tr = simulate(l, env, { stopAtGoalLine: true, ground: false });
  const c = tr.lineCrossing;
  if (!c) throw new Error('ball never crossed the goal line');
  return { t: c.t, x: c.p.x, y: c.p.y, kmh: len(c.v) / KMH };
}

/** Height of the ball centre when the horizontal distance travelled from the origin equals `dist`. */
function heightAtDistance(tr: Trajectory, origin: Vec3, dist: number): number {
  const h = (p: Vec3): number => Math.hypot(p.x - origin.x, p.z - origin.z);
  for (let i = 1; i < tr.samples.length; i++) {
    const a = tr.samples[i - 1].p;
    const b = tr.samples[i].p;
    if (h(a) <= dist && h(b) >= dist) {
      const f = (dist - h(a)) / (h(b) - h(a));
      return a.y + f * (b.y - a.y);
    }
  }
  throw new Error(`trajectory never reached ${dist} m`);
}

/** Logged so docs/PHYSICS.md can quote the measured values. */
function report(row: string, values: Record<string, number>): void {
  const text = Object.entries(values)
    .map(([k, v]) => `${k}=${v !== 0 && Math.abs(v) < 1e-3 ? v.toExponential(2) : v.toFixed(4)}`)
    .join(' ');
  console.log(`[physics-acceptance] ${row}: ${text}`);
}

describe('§4 acceptance targets', () => {
  it('penalty, 11 m, 100 km/h, 2° up, no spin: line in 0.40–0.45 s, arrival 88–92 km/h', () => {
    const c = cross(kick(11, 100, 2));
    report('penalty', { t: c.t, kmh: c.kmh, x: c.x, y: c.y });
    expect(c.t).toBeGreaterThanOrEqual(0.4);
    expect(c.t).toBeLessThanOrEqual(0.45);
    expect(c.kmh).toBeGreaterThanOrEqual(88);
    expect(c.kmh).toBeLessThanOrEqual(92);
  });

  it('free kick, 25 m, 100 km/h, 6° up, side spin 8 rev/s: deviation 2.3–3.0 m, 1.0–1.15 s, 74–80 km/h', () => {
    const c = cross(kick(25, 100, 6, 8));
    report('fk-8rps', { dev: Math.abs(c.x), t: c.t, kmh: c.kmh, y: c.y });
    expect(Math.abs(c.x)).toBeGreaterThanOrEqual(2.3);
    expect(Math.abs(c.x)).toBeLessThanOrEqual(3.0);
    expect(c.t).toBeGreaterThanOrEqual(1.0);
    expect(c.t).toBeLessThanOrEqual(1.15);
    expect(c.kmh).toBeGreaterThanOrEqual(74);
    expect(c.kmh).toBeLessThanOrEqual(80);
  });

  it('same free kick, no spin: deviation < 0.05 m; time and speed within ±3 % of the spin case', () => {
    const spin = cross(kick(25, 100, 6, 8));
    const flat = cross(kick(25, 100, 6, 0));
    report('fk-nospin', {
      dev: Math.abs(flat.x),
      t: flat.t,
      kmh: flat.kmh,
      tRatio: flat.t / spin.t,
      vRatio: flat.kmh / spin.kmh,
    });
    expect(Math.abs(flat.x)).toBeLessThan(0.05);
    expect(Math.abs(flat.t / spin.t - 1)).toBeLessThanOrEqual(0.03);
    expect(Math.abs(flat.kmh / spin.kmh - 1)).toBeLessThanOrEqual(0.03);
  });

  it('free kick, 25 m, 90 km/h, 10° up, side spin 10 rev/s: deviation 2.9–3.6 m', () => {
    const c = cross(kick(25, 90, 10, 10));
    report('fk-10rps', { dev: Math.abs(c.x), t: c.t, kmh: c.kmh, y: c.y });
    expect(Math.abs(c.x)).toBeGreaterThanOrEqual(2.9);
    expect(Math.abs(c.x)).toBeLessThanOrEqual(3.6);
  });

  it('long shot, 28 m, 110 km/h, 8° up: top spin 4 rev/s crosses ≥ 1.5 m lower than no spin', () => {
    const top = cross(kick(28, 110, 8, 0, 4));
    const flat = cross(kick(28, 110, 8, 0, 0));
    report('longshot', { yTop: top.y, yFlat: flat.y, drop: flat.y - top.y });
    expect(flat.y - top.y).toBeGreaterThanOrEqual(1.5);
  });

  it('wall clearance: 15° from 22 m at 95 km/h is ≥ 2.3 m high at 9.15 m from the kick', () => {
    // The row does not state a spin. Without spin it is impossible under §4 (see the next test and
    // docs/DECISIONS.md, D-19 and "Physics engineer"): the kick is the lofted, bottom-of-the-ball strike of §3, i.e. back spin,
    // taken at 10 rev/s — the brief's largest spin magnitude. Launch speed, angle, distance and bound unchanged.
    const l = kick(22, 95, 15, 0, -10);
    const tr = simulate(l, SEA, { stopAtGoalLine: true, ground: false });
    const y = heightAtDistance(tr, l.origin, 9.15);
    report('wall', { y });
    expect(y).toBeGreaterThanOrEqual(2.3);
  });

  it('wall clearance without spin is impossible under §4: even the vacuum parabola is below 2.3 m', () => {
    const l = kick(22, 95, 15);
    const x = 9.15;
    const vac = l.origin.y + x * Math.tan(l.elevation) - (9.81 * x * x) / (2 * (l.speed * Math.cos(l.elevation)) ** 2);
    const tr = simulate(l, SEA, { stopAtGoalLine: true, ground: false });
    const y = heightAtDistance(tr, l.origin, x);
    report('wall-nospin', { vacuum: vac, modelled: y });
    expect(vac).toBeLessThan(2.3);
    expect(y).toBeLessThan(vac);
  });

  it('Nairobi vs sea level: the same free kick bends 12–20 % less at ρ = 0.99', () => {
    const l = kick(25, 100, 6, 8);
    const sea = Math.abs(cross(l, { rho: 1.2, seed: 2026 }).x);
    const nbo = Math.abs(cross(l, { rho: 0.99, seed: 2026 }).x);
    const less = 1 - nbo / sea;
    report('nairobi', { sea, nairobi: nbo, lessFraction: less });
    expect(less).toBeGreaterThanOrEqual(0.12);
    expect(less).toBeLessThanOrEqual(0.2);
  });

  it('energy sanity: ρ = 0, no spin matches the closed-form parabola to 1 mm over 1 s', () => {
    const l: LaunchParams = { ...kick(30, 72, 30), azimuth: 0.2 };
    const tr = simulate(l, { rho: 0, seed: 1 }, { maxTime: 1, stopAtRest: false });
    const v0 = {
      x: l.speed * Math.cos(l.elevation) * Math.sin(l.azimuth),
      y: l.speed * Math.sin(l.elevation),
      z: -l.speed * Math.cos(l.elevation) * Math.cos(l.azimuth),
    };
    expect(tr.samples.length).toBeGreaterThanOrEqual(240);
    expect(tr.samples[tr.samples.length - 1].t).toBeGreaterThanOrEqual(1 - 1e-9);
    let worst = 0;
    for (const s of tr.samples) {
      const e = {
        x: l.origin.x + v0.x * s.t,
        y: l.origin.y + v0.y * s.t - 0.5 * 9.81 * s.t * s.t,
        z: l.origin.z + v0.z * s.t,
      };
      worst = Math.max(worst, Math.hypot(s.p.x - e.x, s.p.y - e.y, s.p.z - e.z));
    }
    report('energy', { worstErrorM: worst });
    expect(worst).toBeLessThan(0.001);
  });
});
