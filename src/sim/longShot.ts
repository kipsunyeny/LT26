// Long shot: push, taker chasing the rolling ball, closing defender.
import type { Collider, Vec3 } from '../contracts';
import { bisectorX } from './freeKick';
import { clamp, flatDir, len, rightOf, sub, v3 } from './vec';

export const LS_KEEPER_Z = 0.6;
/** Push speed for push power 0..1, m/s: a short touch that rolls ≈2–5 m before the taker reaches it. */
export const pushSpeed = (power: number): number => PUSH_MIN_SPEED + PUSH_SPEED_RANGE * clamp(power, 0, 1);
export const PUSH_MIN_SPEED = 2.2;
export const PUSH_SPEED_RANGE = 1.3;

export const TAKER_RUN = { a: 6, v: 7.5, brake: 8, reach: 0.15 } as const;
export const DEFENDER = {
  speed: 6,
  a: 8,
  /** Starts 12 m in front of the ball on the ball→goal-centre line: he closes down the direct line. */
  startAhead: 12,
  startSide: 0,
  reaction: 0.3,
  /** Holds this far from the ball (a closing defender blocks, he does not dive in), m. */
  stopDistance: 3.5,
  /** Arms down, standing: capsule radius and height, m. */
  radius: 0.25,
  height: 1.8,
  restitution: 0.3,
} as const;

export function longShotKeeper(ball: Vec3): { xs: number; z: number } {
  return { xs: bisectorX(ball), z: LS_KEEPER_Z };
}

export interface Mover {
  p: Vec3;
  v: Vec3;
}

/** Accelerates a ground mover towards a desired velocity, |Δv| ≤ a·dt. */
function steer(m: Mover, vdes: Vec3, a: number, dt: number): Mover {
  const dv = sub(vdes, m.v);
  const l = len(dv);
  const k = l > a * dt ? (a * dt) / l : 1;
  const v = v3(m.v.x + dv.x * k, 0, m.v.z + dv.z * k);
  return { p: v3(m.p.x + v.x * dt, 0, m.p.z + v.z * dt), v };
}

/** The ball must first get this far ahead of the taker (after the push) before he can "reach" it again, m. */
export const PUSH_SEPARATION = 0.5;
/** Time the taker needs to finish the push touch before he runs after the ball, s. */
export const PUSH_RECOVERY_S = 0.3;

export interface Chase {
  m: Mover;
  separated: boolean;
}

/**
 * Taker chasing the strike position beside the rolling ball. Returns the new chase state and whether he has
 * reached the ball (only after the push has first put it ≥ 0.5 m ahead of him).
 */
export function chaseStep(
  c: Chase,
  strikePos: Vec3,
  ballVel: Vec3,
  elapsed: number,
  dt: number,
): { c: Chase; reached: boolean } {
  const taker = c.m;
  // Finishing the push touch: he only sets off after PUSH_RECOVERY_S.
  if (elapsed < PUSH_RECOVERY_S) {
    const d0 = len(v3(strikePos.x - taker.p.x, 0, strikePos.z - taker.p.z));
    return { c: { m: taker, separated: c.separated || d0 > PUSH_SEPARATION }, reached: false };
  }
  const d = sub(strikePos, taker.p);
  d.y = 0;
  const dist = len(d);
  const separated = c.separated || dist > PUSH_SEPARATION;
  if (separated && dist < TAKER_RUN.reach) return { c: { m: taker, separated }, reached: true };
  const sp = Math.min(TAKER_RUN.v, Math.sqrt(2 * TAKER_RUN.brake * dist) + Math.hypot(ballVel.x, ballVel.z));
  const vdes = v3((d.x / dist) * sp, 0, (d.z / dist) * sp);
  const m = steer(taker, vdes, TAKER_RUN.a, dt);
  return { c: { m, separated }, reached: separated && len(sub(strikePos, m.p)) < TAKER_RUN.reach };
}

export function defenderStart(ball: Vec3): Vec3 {
  const f = flatDir(ball, v3(0, 0, 0));
  const r = rightOf(f);
  const side = ball.x > 0.5 ? -1 : 1;
  return v3(
    ball.x + f.x * DEFENDER.startAhead + r.x * DEFENDER.startSide * side,
    0,
    ball.z + f.z * DEFENDER.startAhead + r.z * DEFENDER.startSide * side,
  );
}

/** Defender closes on the ball at up to 6 m/s and holds (to block) at 3.5 m. */
export function defenderStep(d: Mover, ball: Vec3, ballVel: Vec3, tSincePush: number, dt: number): Mover {
  if (tSincePush < DEFENDER.reaction) return d;
  const off = v3(ball.x - d.p.x, 0, ball.z - d.p.z);
  const dist = len(off);
  const gap = dist - DEFENDER.stopDistance;
  // Closes at up to 6 m/s, then holds the blocking distance (backing off if the ball rolls at him).
  const sp = Math.sign(gap) * Math.min(DEFENDER.speed, Math.sqrt(2 * 20 * Math.abs(gap)));
  const dir = dist > 1e-9 ? v3(off.x / dist, 0, off.z / dist) : v3(0, 0, 0);
  // Relative to the ball: he matches its approach, so the gap closes at ≤ 6 m/s and settles at stopDistance.
  const approach = Math.min(0, ballVel.x * dir.x + ballVel.z * dir.z);
  const vdes = v3(dir.x * (sp + approach), 0, dir.z * (sp + approach));
  const l = len(vdes);
  const capped = l > DEFENDER.speed ? v3((vdes.x / l) * DEFENDER.speed, 0, (vdes.z / l) * DEFENDER.speed) : vdes;
  return steer(d, capped, gap <= 0.5 ? 20 : DEFENDER.a, dt);
}

export function defenderCollider(d: Mover): Collider {
  return {
    kind: 'capsule',
    tag: 'defender',
    a: v3(d.p.x, DEFENDER.radius, d.p.z),
    b: v3(d.p.x, DEFENDER.height - DEFENDER.radius, d.p.z),
    radius: DEFENDER.radius,
    restitution: DEFENDER.restitution,
    velocity: v3(d.v.x, 0, d.v.z),
  };
}
