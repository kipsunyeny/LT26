// Talilei's position beside the ball (left of it for a right-footer, mirrored for a left-footer).
import type { Settings, Vec3 } from '../contracts';
import { flatDir, rightOf, v3 } from './vec';

export const TAKER_SIDE = 0.6;
export const TAKER_BEHIND = 0.5;
const GOAL_CENTRE = v3(0, 0, 0);

export function footSign(settings: Settings): 1 | -1 {
  return settings.footed === 'left' ? -1 : 1;
}

/** Feet position standing beside the ball, facing the goal centre. */
export function takerStand(ball: Vec3, settings: Settings, side = TAKER_SIDE, behind = TAKER_BEHIND): Vec3 {
  const f = flatDir(ball, GOAL_CENTRE);
  const r = rightOf(f);
  const s = footSign(settings);
  return v3(ball.x - r.x * side * s - f.x * behind, 0, ball.z - r.z * side * s - f.z * behind);
}
