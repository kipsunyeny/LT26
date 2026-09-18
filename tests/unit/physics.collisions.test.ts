import { describe, expect, it } from 'vitest';
import type { BallState, Collider, ContactEvent, LaunchParams, PhysicsEnv, Vec3 } from '../../src/contracts';
import {
  BALL_RADIUS,
  DT,
  GOAL_HALF_WIDTH,
  GOAL_HEIGHT,
  NET_DEPTH,
  POST_RADIUS,
  createKnuckleNoise,
  goalFrameColliders,
  launchState,
  simulate,
  stepBall,
} from '../../src/physics';

const ZERO: Vec3 = { x: 0, y: 0, z: 0 };
const SEA: PhysicsEnv = { rho: 1.2, seed: 3 };
const VAC: PhysicsEnv = { rho: 0, seed: 3 };
const NOGRAV: PhysicsEnv = { rho: 0, seed: 3, g: 0 };
const len = (v: Vec3): number => Math.hypot(v.x, v.y, v.z);
const hspeed = (v: Vec3): number => Math.hypot(v.x, v.z);

function state(p: Vec3, v: Vec3, w: Vec3 = ZERO): BallState {
  return { t: 0, p, v, w };
}

/** Steps until the first contact (or maxSteps); returns the states either side of it. */
function stepUntilContact(
  s0: BallState,
  env: PhysicsEnv,
  colliders: readonly Collider[] = [],
  maxSteps = 2000,
): { before: BallState; after: BallState; contact: ContactEvent } {
  const noise = createKnuckleNoise(env.seed);
  let s = s0;
  for (let i = 0; i < maxSteps; i++) {
    const r = stepBall(s, DT, env, noise, colliders);
    if (r.contacts.length > 0) return { before: s, after: r.state, contact: r.contacts[0] };
    s = r.state;
  }
  throw new Error('no contact');
}

describe('goal frame', () => {
  it('posts and bar are capsules on the correct centre lines; the net is a 2 m absorb box', () => {
    const cs = goalFrameColliders();
    const posts = cs.filter((c) => c.tag === 'post');
    const bars = cs.filter((c) => c.tag === 'bar');
    const nets = cs.filter((c) => c.tag === 'net');
    expect(posts).toHaveLength(2);
    expect(bars).toHaveLength(1);
    expect(nets).toHaveLength(1);
    const cx = GOAL_HALF_WIDTH + POST_RADIUS;
    const cy = GOAL_HEIGHT + POST_RADIUS;
    for (const p of posts) {
      if (p.kind !== 'capsule') throw new Error('post must be a capsule');
      expect(Math.abs(p.a.x)).toBeCloseTo(cx, 12);
      expect(p.a.x).toBe(p.b.x);
      expect(p.a.z).toBe(0);
      expect(Math.min(p.a.y, p.b.y)).toBe(0);
      expect(Math.max(p.a.y, p.b.y)).toBeCloseTo(cy, 12);
      expect(p.radius).toBe(POST_RADIUS);
      expect(p.restitution).toBe(0.7);
    }
    const bar = bars[0];
    if (bar.kind !== 'capsule') throw new Error('bar must be a capsule');
    expect(bar.a.y).toBeCloseTo(cy, 12);
    expect(bar.b.y).toBeCloseTo(cy, 12);
    expect(Math.abs(bar.a.x - bar.b.x)).toBeCloseTo(2 * cx, 12);
    const net = nets[0];
    if (net.kind !== 'absorbBox') throw new Error('net must be an absorbBox');
    expect(net.max.z).toBe(0);
    expect(net.min.z).toBe(-NET_DEPTH);
    expect(NET_DEPTH).toBe(2);
    expect(net.min.y).toBe(0);
  });
});

describe('ground', () => {
  it('bounce restitution 0.6: a dropped ball rebounds to 0.36 of its drop height; contact reported', () => {
    const tr = simulate(
      { origin: { x: 0, y: 2.11, z: 5 }, speed: 0, azimuth: 0, elevation: 0, sideSpin: 0, topSpin: 0 },
      VAC,
      { maxTime: 2, stopAtRest: false },
    );
    const first = tr.contacts[0];
    expect(first.tag).toBe('ground');
    expect(first.colliderIndex).toBe(-1);
    expect(first.point.y).toBeCloseTo(0, 2);
    expect(first.speedBefore).toBeCloseTo(Math.sqrt(2 * 9.81 * 2), 1);
    const after = tr.samples.filter((s) => s.t > first.t && s.t < first.t + 0.8);
    const apex = Math.max(...after.map((s) => s.p.y)) - BALL_RADIUS;
    expect(apex / 2).toBeGreaterThan(0.36 * 0.97);
    expect(apex / 2).toBeLessThan(0.36 * 1.03);
  });

  it('a ball rolling at 4 m/s stops in ≈ 10 m (8.5–11.5 m)', () => {
    const rollingTop = 4 / (2 * Math.PI * BALL_RADIUS);
    const l: LaunchParams = {
      origin: { x: 0, y: BALL_RADIUS, z: 30 },
      speed: 4,
      azimuth: 0,
      elevation: 0,
      sideSpin: 0,
      topSpin: rollingTop,
    };
    const tr = simulate(l, SEA, { maxTime: 20 });
    const end = tr.samples[tr.samples.length - 1];
    const d = 30 - end.p.z;
    console.log(`[physics-collisions] roll 4 m/s: stop distance ${d.toFixed(3)} m after ${end.t.toFixed(2)} s`);
    expect(len(end.v)).toBe(0);
    expect(end.t).toBeLessThan(19);
    expect(d).toBeGreaterThanOrEqual(8.5);
    expect(d).toBeLessThanOrEqual(11.5);
    expect(Math.abs(end.p.x)).toBeLessThan(1e-9);
    expect(end.p.y).toBeCloseTo(BALL_RADIUS, 6);
  });

  it('friction μ = 0.4 couples spin and speed at a bounce: back spin loses, top spin gains forward speed', () => {
    const v = { x: 0, y: -4, z: -8 };
    const p = { x: 0, y: BALL_RADIUS + 0.005, z: 10 };
    const back = stepUntilContact(state(p, v, { x: 2 * Math.PI * 15, y: 0, z: 0 }), VAC);
    const top = stepUntilContact(state(p, v, { x: -2 * Math.PI * 15, y: 0, z: 0 }), VAC);
    const none = stepUntilContact(state(p, v), VAC);
    expect(hspeed(back.after.v)).toBeLessThan(hspeed(back.before.v) - 0.5);
    expect(hspeed(top.after.v)).toBeGreaterThan(hspeed(top.before.v) + 0.5);
    expect(hspeed(none.after.v)).toBeLessThan(hspeed(none.before.v));
    // bounded by μ(1+e)|vy| — Coulomb limit on the tangential impulse
    for (const r of [back, top, none]) {
      expect(Math.abs(hspeed(r.after.v) - hspeed(r.before.v))).toBeLessThanOrEqual(0.4 * 1.6 * 4.1 + 1e-9);
      expect(r.after.v.y).toBeGreaterThan(0);
      expect(r.contact.tag).toBe('ground');
    }
    // the spinless ball picks up forward-rolling (top) spin: ω_x < 0 when moving along −z
    expect(none.after.w.x).toBeLessThan(0);
  });

  it('a sliding (spinless) ball on the ground ends up rolling without slip', () => {
    const noise = createKnuckleNoise(1);
    let s = state({ x: 0, y: BALL_RADIUS, z: 20 }, { x: 0, y: 0, z: -6 });
    for (let i = 0; i < 240; i++) s = stepBall(s, DT, SEA, noise).state;
    const slip = s.v.z - BALL_RADIUS * s.w.x;
    expect(Math.abs(slip)).toBeLessThan(1e-6);
    expect(Math.abs(s.v.z)).toBeGreaterThan(2);
    expect(Math.abs(s.v.z)).toBeLessThan(6 * 0.6 + 1e-6);
  });
});

describe('frame and net', () => {
  it('post hit: restitution 0.7 on the normal component, contact tag/speed reported', () => {
    const cs = goalFrameColliders();
    const x = GOAL_HALF_WIDTH + POST_RADIUS;
    const r = stepUntilContact(state({ x, y: 1, z: 2 }, { x: 0, y: 0, z: -20 }), NOGRAV, cs);
    expect(r.contact.tag).toBe('post');
    expect(cs[r.contact.colliderIndex].tag).toBe('post');
    expect(r.contact.speedBefore).toBeCloseTo(20, 9);
    expect(r.after.v.z).toBeCloseTo(14, 6);
    expect(r.contact.point.z).toBeCloseTo(POST_RADIUS, 6);
    expect(r.after.p.z).toBeGreaterThanOrEqual(POST_RADIUS + BALL_RADIUS - 1e-9);
  });

  it('crossbar hit is tagged bar', () => {
    const cs = goalFrameColliders();
    const r = stepUntilContact(state({ x: 0, y: GOAL_HEIGHT + POST_RADIUS, z: 2 }, { x: 0, y: 0, z: -25 }), NOGRAV, cs);
    expect(r.contact.tag).toBe('bar');
    expect(r.after.v.z).toBeCloseTo(17.5, 6);
  });

  it('net absorbs: the ball ends inside the net box, at rest on the ground, never bouncing back out', () => {
    const l: LaunchParams = {
      origin: { x: 0, y: BALL_RADIUS, z: 11 },
      speed: 30,
      azimuth: 0.05,
      elevation: 0.1,
      sideSpin: 0,
      topSpin: 0,
    };
    const cs = goalFrameColliders();
    const tr = simulate(l, SEA, { colliders: () => cs, maxTime: 6 });
    const end = tr.samples[tr.samples.length - 1];
    expect(tr.lineCrossing).not.toBeNull();
    expect(tr.contacts.some((c) => c.tag === 'net')).toBe(true);
    const net = tr.contacts.find((c) => c.tag === 'net') as ContactEvent;
    expect(net.speedBefore).toBeGreaterThan(20);
    expect(end.p.z).toBeLessThan(0);
    expect(end.p.z).toBeGreaterThan(-NET_DEPTH);
    expect(Math.abs(end.p.x)).toBeLessThan(GOAL_HALF_WIDTH);
    expect(end.p.y).toBeCloseTo(BALL_RADIUS, 3);
    expect(len(end.v)).toBeLessThan(0.1);
    const crossT = (tr.lineCrossing as { t: number }).t;
    for (const s of tr.samples) if (s.t > crossT + 0.01) expect(s.p.z).toBeLessThan(0);
  });

  it('side netting hit from outside keeps the ball outside the goal', () => {
    const cs = goalFrameColliders();
    const tr = simulate(
      { origin: { x: 4.6, y: 0.6, z: 3 }, speed: 12, azimuth: -0.17, elevation: 0.05, sideSpin: 0, topSpin: 0 },
      SEA,
      { colliders: () => cs, maxTime: 4 },
    );
    expect(tr.contacts.some((c) => c.tag === 'net')).toBe(true);
    for (const s of tr.samples) if (s.p.z < 0) expect(s.p.x).toBeGreaterThan(GOAL_HALF_WIDTH + 2 * POST_RADIUS);
  });
});

describe('moving colliders', () => {
  it('sphere moving into a resting ball reflects the relative velocity (restitution 0.5)', () => {
    const noise = createKnuckleNoise(1);
    const c: Collider = {
      kind: 'sphere',
      tag: 'keeperHand',
      center: { x: -0.3, y: 1, z: 0 },
      radius: 0.2,
      restitution: 0.5,
      velocity: { x: 3, y: 0, z: 0 },
    };
    const r = stepBall(state({ x: 0, y: 1, z: 0 }, ZERO), DT, NOGRAV, noise, [c]);
    expect(r.contacts).toHaveLength(1);
    expect(r.contacts[0].tag).toBe('keeperHand');
    expect(r.contacts[0].colliderIndex).toBe(0);
    expect(r.contacts[0].speedBefore).toBe(0);
    expect(r.state.v.x).toBeCloseTo(4.5, 9);
    expect(r.state.v.y).toBeCloseTo(0, 9);
    expect(r.state.p.x).toBeGreaterThanOrEqual(-0.3 + 0.2 + BALL_RADIUS - 1e-9);
  });

  it('capsule (jumping wall player) moving up into a falling ball pushes it up', () => {
    const noise = createKnuckleNoise(1);
    const c: Collider = {
      kind: 'capsule',
      tag: 'wall',
      a: { x: -1, y: 1.6, z: 9 },
      b: { x: 1, y: 1.6, z: 9 },
      radius: 0.25,
      restitution: 0.4,
      velocity: { x: 0, y: 2, z: 0 },
    };
    const r = stepBall(state({ x: 0, y: 1.95, z: 9 }, { x: 0, y: -1, z: 0 }), DT, NOGRAV, noise, [c]);
    expect(r.contacts[0].tag).toBe('wall');
    expect(r.contacts[0].speedBefore).toBeCloseTo(1, 9);
    // relative normal velocity −3 → +1.2, plus the collider's 2 m/s
    expect(r.state.v.y).toBeCloseTo(3.2, 9);
  });

  it('a ball moving away from an overlapping collider is not pulled back', () => {
    const noise = createKnuckleNoise(1);
    const c: Collider = {
      kind: 'sphere',
      tag: 'keeperBody',
      center: { x: 0, y: 1, z: 0 },
      radius: 0.3,
      restitution: 0.5,
    };
    const r = stepBall(state({ x: 0.35, y: 1, z: 0 }, { x: 5, y: 0, z: 0 }), DT, NOGRAV, noise, [c]);
    expect(r.contacts).toHaveLength(0);
    expect(r.state.v.x).toBe(5);
  });

  it('a fast ball does not tunnel through a thin collider in one step', () => {
    const noise = createKnuckleNoise(1);
    const c: Collider = {
      kind: 'sphere',
      tag: 'keeperHand',
      center: { x: 0, y: 1, z: 0 },
      radius: 0.1,
      restitution: 0.3,
    };
    const r = stepBall(state({ x: 0, y: 1, z: 0.35 }, { x: 0, y: 0, z: -150 }), DT, NOGRAV, noise, [c]);
    expect(r.contacts).toHaveLength(1);
    expect(r.state.v.z).toBeGreaterThan(0);
    expect(launchState).toBeTypeOf('function');
  });
});
