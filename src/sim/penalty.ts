// Penalty: run-up of the taker and the keeper's read of it.
import type { Settings, Vec3 } from '../contracts';
import { flatDir, lerp, rightOf, v3 } from './vec';
import { footSign, takerStand } from './taker';

export const RUN_UP_TIME = 0.9;
export const PK_KEEPER = { xs: 0, z: 0.15 } as const;
/** A target within this distance of the centre reads as "no side". */
export const CENTRAL_AIM = 0.5;

/** Start of the run-up: ≈2.5 m behind-left of the ball (mirrored for a left-footer). */
export function runUpStart(ball: Vec3, settings: Settings): Vec3 {
  const f = flatDir(ball, v3(0, 0, 0));
  const r = rightOf(f);
  const s = footSign(settings);
  return v3(ball.x - r.x * 1.3 * s - f.x * 2.2, 0, ball.z - r.z * 1.3 * s - f.z * 2.2);
}

/** Taker's feet during the run-up, stride 0 → 1. */
export function runUpPosition(ball: Vec3, settings: Settings, stride: number): Vec3 {
  const e = stride * stride * (3 - 2 * stride);
  return lerp(runUpStart(ball, settings), takerStand(ball, settings), e);
}

export function aimSide(crossingX: number | null): -1 | 0 | 1 {
  if (crossingX === null || Math.abs(crossingX) < CENTRAL_AIM) return 0;
  return crossingX < 0 ? -1 : 1;
}
