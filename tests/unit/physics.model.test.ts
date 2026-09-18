import { describe, expect, it } from 'vitest';
import type { BallState, LaunchParams, PhysicsEnv, Vec3 } from '../../src/contracts';
import {
  BALL_AREA,
  BALL_MASS,
  BALL_RADIUS,
  SPIN_DECAY_TAU,
  acceleration,
  createKnuckleNoise,
  dragCoefficient,
  gaussian,
  launchState,
  liftCoefficient,
  mulberry32,
  simulate,
  spinVector,
} from '../../src/physics';

const ZERO: Vec3 = { x: 0, y: 0, z: 0 };
const SEA: PhysicsEnv = { rho: 1.2, seed: 7 };
const len = (v: Vec3): number => Math.hypot(v.x, v.y, v.z);

function fk(sideSpin: number, topSpin = 0, speed = 100 / 3.6): LaunchParams {
  return { origin: { x: 0, y: 0.11, z: 25 }, speed, azimuth: 0, elevation: 0.1, sideSpin, topSpin };
}

describe('aerodynamic coefficients', () => {
  it('drag crisis: Cd ≈ 0.5 at low speed, ≈ 0.2 at high speed, formula exact', () => {
    for (const v of [0, 3, 5, 8]) {
      expect(dragCoefficient(v)).toBeGreaterThanOrEqual(0.47);
      expect(dragCoefficient(v)).toBeLessThanOrEqual(0.5);
    }
    for (const v of [17, 20, 25, 35]) {
      expect(dragCoefficient(v)).toBeGreaterThanOrEqual(0.2);
      expect(dragCoefficient(v)).toBeLessThanOrEqual(0.24);
    }
    expect(dragCoefficient(13)).toBeCloseTo(0.35, 12);
    expect(dragCoefficient(15)).toBeCloseTo(0.2 + 0.3 / (1 + Math.exp(1)), 12);
    // monotonic decrease through the crisis
    for (let v = 0; v < 40; v += 0.5) expect(dragCoefficient(v + 0.5)).toBeLessThan(dragCoefficient(v));
  });

  it('lift coefficient Cl = 1 / (2 + 1/S), 0 at S = 0', () => {
    expect(liftCoefficient(0)).toBe(0);
    expect(liftCoefficient(0.25)).toBeCloseTo(1 / 6, 12);
    expect(liftCoefficient(1)).toBeCloseTo(1 / 3, 12);
    expect(liftCoefficient(0.1)).toBeCloseTo(1 / 12, 12);
  });

  it('ball constants', () => {
    expect(BALL_MASS).toBe(0.43);
    expect(BALL_RADIUS).toBe(0.11);
    expect(BALL_AREA).toBeCloseTo(Math.PI * 0.11 * 0.11, 12);
  });

  it('Magnus acceleration matches ½ρClA|v|²(ω×v)/(|ω||v|)/m, and is zero for |ω| < 0.5 rad/s', () => {
    const v = { x: 0, y: 0, z: -20 };
    const noSpin = acceleration({ t: 0, p: { x: 0, y: 1, z: 10 }, v, w: ZERO }, SEA, ZERO);
    const tiny = acceleration({ t: 0, p: { x: 0, y: 1, z: 10 }, v, w: { x: 0, y: -0.49, z: 0 } }, SEA, ZERO);
    expect(tiny).toEqual(noSpin);
    const w = { x: 0, y: -40, z: 0 };
    const a = acceleration({ t: 0, p: { x: 0, y: 1, z: 10 }, v, w }, SEA, ZERO);
    const S = (BALL_RADIUS * 40) / 20;
    const expected = (0.5 * 1.2 * liftCoefficient(S) * BALL_AREA * 400) / BALL_MASS;
    expect(a.x - noSpin.x).toBeCloseTo(expected, 10);
    expect(a.x).toBeGreaterThan(0);
    const justAbove = acceleration({ t: 0, p: { x: 0, y: 1, z: 10 }, v, w: { x: 0, y: -0.51, z: 0 } }, SEA, ZERO);
    expect(justAbove.x).toBeGreaterThan(0);
  });

  it('drag and gravity: spinless acceleration = g + drag opposite v', () => {
    const v = { x: 3, y: 4, z: -12 };
    const a = acceleration({ t: 0, p: { x: 0, y: 1, z: 10 }, v, w: ZERO }, SEA, ZERO);
    const s = len(v);
    const k = (0.5 * 1.2 * dragCoefficient(s) * BALL_AREA * s) / BALL_MASS;
    expect(a.x).toBeCloseTo(-k * v.x, 12);
    expect(a.y).toBeCloseTo(-9.81 - k * v.y, 12);
    expect(a.z).toBeCloseTo(-k * v.z, 12);
  });
});

describe('spin conventions', () => {
  it('spinVector: ω = 2π(−side ŷ − top r̂) with r̂ = (cos az, 0, sin az)', () => {
    const w = spinVector(0, 1, 0);
    expect(w.y).toBeCloseTo(-2 * Math.PI, 12);
    const t = spinVector(0, 0, 1);
    expect(t.x).toBeCloseTo(-2 * Math.PI, 12);
    expect(t.z).toBeCloseTo(0, 12);
    const az = 0.3;
    const u = spinVector(az, 0, 2);
    expect(u.x).toBeCloseTo(-4 * Math.PI * Math.cos(az), 12);
    expect(u.z).toBeCloseTo(-4 * Math.PI * Math.sin(az), 12);
  });

  it('launchState builds velocity along the azimuth/elevation and the spin vector', () => {
    const l: LaunchParams = {
      origin: { x: 1, y: 0.11, z: 20 },
      speed: 25,
      azimuth: 0.2,
      elevation: 0.1,
      sideSpin: 3,
      topSpin: -2,
    };
    const s = launchState(l);
    expect(s.t).toBe(0);
    expect(s.p).toEqual(l.origin);
    expect(s.v.x).toBeCloseTo(25 * Math.cos(0.1) * Math.sin(0.2), 12);
    expect(s.v.y).toBeCloseTo(25 * Math.sin(0.1), 12);
    expect(s.v.z).toBeCloseTo(-25 * Math.cos(0.1) * Math.cos(0.2), 12);
    expect(s.w).toEqual(spinVector(0.2, 3, -2));
  });

  it('sideSpin > 0 ends to +x, < 0 to −x; topSpin > 0 lower, < 0 higher', () => {
    const cx = (l: LaunchParams): Vec3 => {
      const c = simulate(l, SEA, { stopAtGoalLine: true, ground: false }).lineCrossing;
      if (!c) throw new Error('no crossing');
      return c.p;
    };
    expect(cx(fk(6)).x).toBeGreaterThan(1);
    expect(cx(fk(-6)).x).toBeLessThan(-1);
    const flat = cx(fk(0)).y;
    expect(cx(fk(0, 4)).y).toBeLessThan(flat - 0.5);
    expect(cx(fk(0, -4)).y).toBeGreaterThan(flat + 0.5);
  });

  it(`spin decays exponentially in flight with τ = ${SPIN_DECAY_TAU} s`, () => {
    const l: LaunchParams = {
      origin: { x: 0, y: 0.11, z: 30 },
      speed: 20,
      azimuth: 0,
      elevation: 0.9,
      sideSpin: 5,
      topSpin: 2,
    };
    const tr = simulate(l, SEA, { maxTime: 1.5, stopAtRest: false });
    const w0 = len(tr.samples[0].w);
    const s1 = tr.samples.find((s) => Math.abs(s.t - 1) < 1e-9) as BallState;
    expect(s1.p.y).toBeGreaterThan(1);
    expect(len(s1.w) / w0).toBeCloseTo(Math.exp(-1 / SPIN_DECAY_TAU), 9);
  });
});

describe('rng and knuckle noise', () => {
  it('mulberry32 is deterministic and in [0, 1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });

  it('gaussian has mean ≈ 0 and σ ≈ 1', () => {
    const r = mulberry32(9);
    let s = 0;
    let s2 = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const g = gaussian(r);
      s += g;
      s2 += g * g;
    }
    expect(Math.abs(s / n)).toBeLessThan(0.03);
    expect(Math.abs(Math.sqrt(s2 / n) - 1)).toBeLessThan(0.03);
  });

  it('knuckle noise: bounded by 0.25 m/s², continuous, only for near-zero spin above 20 m/s', () => {
    const n = createKnuckleNoise(123);
    let prev = n.sample(0, 30, 0);
    let maxMag = 0;
    let maxJump = 0;
    for (let i = 1; i <= 2400; i++) {
      const t = i / 240;
      const a = n.sample(t, 30, 0);
      maxMag = Math.max(maxMag, len(a));
      maxJump = Math.max(maxJump, len({ x: a.x - prev.x, y: a.y - prev.y, z: a.z - prev.z }));
      prev = a;
    }
    expect(maxMag).toBeLessThanOrEqual(0.25 + 1e-12);
    expect(maxMag).toBeGreaterThan(0.1);
    expect(maxJump).toBeLessThan(0.25);
    expect(len(n.sample(0.37, 19.9, 0))).toBe(0);
    expect(len(n.sample(0.37, 30, 20))).toBe(0);
    expect(createKnuckleNoise(123).sample(0.37, 30, 0)).toEqual(n.sample(0.37, 30, 0));
    expect(createKnuckleNoise(124).sample(0.37, 30, 0)).not.toEqual(n.sample(0.37, 30, 0));
  });
});

describe('determinism', () => {
  it('same seed ⇒ bit-identical trajectory', () => {
    for (const l of [fk(0), fk(8), fk(-3, 2)]) {
      const a = simulate(l, SEA);
      const b = simulate(l, SEA);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  it('a different seed changes only knuckle (spinless, fast) kicks', () => {
    const other: PhysicsEnv = { rho: 1.2, seed: 8 };
    const k1 = simulate(fk(0), SEA, { stopAtGoalLine: true });
    const k2 = simulate(fk(0), other, { stopAtGoalLine: true });
    expect(JSON.stringify(k1)).not.toBe(JSON.stringify(k2));
    const s1 = simulate(fk(8), SEA, { stopAtGoalLine: true });
    const s2 = simulate(fk(8), other, { stopAtGoalLine: true });
    expect(JSON.stringify(s1)).toBe(JSON.stringify(s2));
    const slow1 = simulate(fk(0, 0, 15), SEA);
    const slow2 = simulate(fk(0, 0, 15), other);
    expect(JSON.stringify(slow1)).toBe(JSON.stringify(slow2));
  });
});
