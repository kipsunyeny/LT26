// Free kick set-up: wall covering the near post, keeper covering the far side.
import type { Vec3 } from '../contracts';
import { layoutWall, type WallLayout } from './wall';

export const FK_KEEPER_Z = 0.5;
/** How far the keeper stands from the angle bisector towards the far post, m. */
export const FK_KEEPER_FAR_SHIFT = 0.8;
/** Extra reaction time because the wall screens the keeper's view, s. */
export const FK_SCREEN_DELAY = 0.1;

/** Where the bisector of the goal angle seen from the ball meets the goal line (angle-bisector theorem). */
export function bisectorX(ball: Vec3): number {
  const dl = Math.hypot(ball.x + 3.66, ball.z);
  const dr = Math.hypot(ball.x - 3.66, ball.z);
  return -3.66 + (7.32 * dl) / (dl + dr);
}

export interface FreeKickSetup {
  wall: WallLayout;
  keeper: { xs: number; z: number };
}

export function freeKickSetup(ball: Vec3): FreeKickSetup {
  const wall = layoutWall(ball);
  return { wall, keeper: { xs: bisectorX(ball) - wall.nearSide * FK_KEEPER_FAR_SHIFT, z: FK_KEEPER_Z } };
}
