// Defensive wall for free kicks: placement at 9.15 m covering the near post, and the jump.
import type { Collider, Vec3 } from '../contracts';
import { flatDir, v3 } from './vec';

export const WALL_DISTANCE = 9.15;
/** Centre-to-centre spacing of defenders standing shoulder to shoulder, m. */
export const WALL_SPACING = 0.5;
export const DEFENDER_RADIUS = 0.22;
export const DEFENDER_HEIGHT = 1.85;
export const WALL_JUMP_HEIGHT = 0.4;
export const WALL_JUMP_DELAY = 0.15;
export const WALL_RESTITUTION = 0.3;
const G = 9.81;
const JUMP_V0 = Math.sqrt(2 * G * WALL_JUMP_HEIGHT);
export const WALL_AIR_TIME = (2 * JUMP_V0) / G;
/** Near-post aim point for the outside defender: the post's centre line. */
const POST_X = 3.72;

export interface WallLayout {
  /** Feet positions, outside man (on the ball→near-post line) first. */
  feet: Vec3[];
  /** −1: wall covers the left post (x < 0); +1: the right post. */
  nearSide: -1 | 1;
}

/** Near post: the post on the ball's side; a central ball (|x| < 0.5) is treated as left (right-footer's natural bend). */
export function nearSide(ball: Vec3): -1 | 1 {
  return ball.x > 0.5 ? 1 : -1;
}

/** Angle subtended by the goal mouth from the ball, radians. */
export function goalAngle(ball: Vec3): number {
  const a = Math.atan2(-3.66 - ball.x, ball.z);
  const b = Math.atan2(3.66 - ball.x, ball.z);
  return Math.abs(b - a);
}

/** 3–5 defenders: more when the goal looks bigger (closer and more central). */
export function wallCount(ball: Vec3): number {
  const deg = (goalAngle(ball) * 180) / Math.PI;
  if (deg >= 16) return 5;
  if (deg >= 12.5) return 4;
  return 3;
}

/**
 * The wall line is perpendicular to the ball→near-post direction at 9.15 m from the ball. The outside
 * defender stands on that line (his centre on the ball→post line); the others extend towards the goal centre.
 */
export function layoutWall(ball: Vec3): WallLayout {
  const side = nearSide(ball);
  const post = v3(side * POST_X, 0, 0);
  const f = flatDir(ball, post);
  const anchor = v3(ball.x + f.x * WALL_DISTANCE, 0, ball.z + f.z * WALL_DISTANCE);
  // Perpendicular pointing from the post line towards the goal centre side.
  let perp = v3(-f.z, 0, f.x);
  if (perp.x * -side < 0) perp = v3(-perp.x, 0, -perp.z);
  const n = wallCount(ball);
  const feet: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    feet.push(v3(anchor.x + perp.x * WALL_SPACING * i, 0, anchor.z + perp.z * WALL_SPACING * i));
  }
  return { feet, nearSide: side };
}

/** Jump height of the wall `tSinceStrike` seconds after the strike (ballistic, 0.4 m peak, 0.15 s delay). */
export function wallJumpHeight(tSinceStrike: number | null): number {
  if (tSinceStrike === null) return 0;
  const tau = tSinceStrike - WALL_JUMP_DELAY;
  if (tau <= 0 || tau >= WALL_AIR_TIME) return 0;
  return JUMP_V0 * tau - 0.5 * G * tau * tau;
}

/** Vertical speed of the jumping wall, m/s. */
export function wallJumpSpeed(tSinceStrike: number | null): number {
  if (tSinceStrike === null) return 0;
  const tau = tSinceStrike - WALL_JUMP_DELAY;
  if (tau <= 0 || tau >= WALL_AIR_TIME) return 0;
  return JUMP_V0 - G * tau;
}

export function wallColliders(layout: WallLayout, jump: number, vy = 0): Collider[] {
  return layout.feet.map((p) => ({
    kind: 'capsule',
    tag: 'wall',
    a: v3(p.x, DEFENDER_RADIUS + jump, p.z),
    b: v3(p.x, DEFENDER_HEIGHT - DEFENDER_RADIUS + jump, p.z),
    radius: DEFENDER_RADIUS,
    restitution: WALL_RESTITUTION,
    velocity: v3(0, vy, 0),
  }));
}
