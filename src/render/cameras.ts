// Pure camera placement math (no Three.js) so it can be unit-tested in Node.
import type { Vec3 } from '../contracts';

export interface CameraPose {
  position: Vec3;
  target: Vec3;
  /** Vertical field of view, degrees. */
  fov: number;
}

/** Kick camera constants (brief §2: ≈2.3 m high, 4–5 m behind the ball, vertical FOV ≈ 46°). */
export const KICK_CAMERA = {
  fov: 46,
  height: 2.3,
  back: 4.5,
  /** Sideways shift away from the taker so Talilei sits in the lower-left (right-footer). */
  side: 0.5,
  /** Where the resting ball should appear, as NDC y (-1 bottom, +1 top). */
  ballNdcY: -0.55,
} as const;

const GOAL_CENTRE = { x: 0, z: 0 };
const DEG = Math.PI / 180;

/** Horizontal unit vector from the ball towards the goal centre (falls back to -z). */
export function ballToGoalDir(ball: Vec3): { x: number; z: number } {
  const dx = GOAL_CENTRE.x - ball.x;
  const dz = GOAL_CENTRE.z - ball.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return { x: 0, z: -1 };
  return { x: dx / len, z: dz / len };
}

/**
 * Which side of the ball→goal line the taker stands on: -1 = kicker's left (right-footer), +1 = right.
 * "Right" is the direction (-dz, dx) of the ball→goal direction d, i.e. +x when facing -z.
 */
export function takerSide(ball: Vec3, taker: Vec3): -1 | 1 {
  const d = ballToGoalDir(ball);
  const rx = -d.z;
  const rz = d.x;
  const dot = (taker.x - ball.x) * rx + (taker.z - ball.z) * rz;
  return dot > 0 ? 1 : -1;
}

/**
 * Kick camera: behind the ball on the ball→goal line, raised, shifted away from the taker.
 * Yaw looks at the goal centre; pitch is chosen so the ball lands at KICK_CAMERA.ballNdcY,
 * which keeps the goal in the upper-middle of the frame at every distance (11–35 m).
 */
export function kickCameraPose(ball: Vec3, side: -1 | 1): CameraPose {
  const d = ballToGoalDir(ball);
  const r = { x: -d.z, z: d.x };
  const lateral = -side * KICK_CAMERA.side;
  const position: Vec3 = {
    x: ball.x - d.x * KICK_CAMERA.back + r.x * lateral,
    y: KICK_CAMERA.height,
    z: ball.z - d.z * KICK_CAMERA.back + r.z * lateral,
  };
  // Yaw towards the goal centre.
  const gx = GOAL_CENTRE.x - position.x;
  const gz = GOAL_CENTRE.z - position.z;
  const gLen = Math.hypot(gx, gz) || 1;
  const fx = gx / gLen;
  const fz = gz / gLen;
  // Angle of the ball below the horizon, measured along the view direction.
  const ballDepth = (ball.x - position.x) * fx + (ball.z - position.z) * fz;
  const ballDrop = Math.atan2(position.y - Math.max(ball.y, 0.11), Math.max(ballDepth, 0.5));
  const offset = Math.atan(-KICK_CAMERA.ballNdcY * Math.tan((KICK_CAMERA.fov / 2) * DEG));
  const pitchDown = ballDrop - offset;
  const cp = Math.cos(pitchDown);
  const target: Vec3 = {
    x: position.x + fx * cp * 10,
    y: position.y - Math.sin(pitchDown) * 10,
    z: position.z + fz * cp * 10,
  };
  return { position, target, fov: KICK_CAMERA.fov };
}

export interface PathBounds {
  center: Vec3;
  radius: number;
  start: Vec3;
}

/** Bounding sphere (box centre + half diagonal) of a path; includes the goal mouth so it stays in shot. */
export function pathBounds(points: readonly Vec3[], fallbackBall: Vec3): PathBounds {
  const pts = points.length > 0 ? points : [fallbackBall];
  let minX = -3.66;
  let maxX = 3.66;
  let minY = 0;
  let maxY = 2.44;
  let minZ = 0;
  let maxZ = 0;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 };
  const radius = Math.max(6, 0.5 * Math.hypot(maxX - minX, maxY - minY, maxZ - minZ));
  return { center, radius, start: pts[0] };
}

export const REPLAY_CAMERA = {
  fov: 40,
  /** Elevation of the orbit above the path centre, degrees. */
  elevation: 26,
  /** Base azimuth from the flight axis (degrees; 90 = pure side view). */
  azimuth: 68,
  /** Orbit sweep amplitude (degrees) and period (s). */
  sweep: 18,
  period: 30,
} as const;

/**
 * Replay orbit: a high side camera around the flight's bounding sphere, distance chosen so the sphere
 * fits the narrower field of view, slowly sweeping ±REPLAY_CAMERA.sweep degrees.
 * The camera sits on the side opposite the ball's start so the kicker never blocks the path.
 */
export function replayCameraPose(b: PathBounds, time: number, aspect: number): CameraPose {
  const vHalf = (REPLAY_CAMERA.fov / 2) * DEG;
  const hHalf = Math.atan(Math.tan(vHalf) * Math.max(aspect, 0.2));
  const dist = (b.radius / Math.sin(Math.min(vHalf, hHalf))) * 1.02;
  const side = b.start.x > 0.5 ? -1 : 1;
  const az =
    (REPLAY_CAMERA.azimuth + REPLAY_CAMERA.sweep * Math.sin((2 * Math.PI * time) / REPLAY_CAMERA.period)) * DEG;
  const el = REPLAY_CAMERA.elevation * DEG;
  const horiz = dist * Math.cos(el);
  const position: Vec3 = {
    x: b.center.x + side * Math.sin(az) * horiz,
    y: Math.max(2, b.center.y + dist * Math.sin(el)),
    z: b.center.z + Math.cos(az) * horiz,
  };
  return { position, target: { ...b.center }, fov: REPLAY_CAMERA.fov };
}

/** Title: low dramatic view from the edge of the box towards the goal and the main stand, gently drifting. */
export function titleCameraPose(time: number): CameraPose {
  const s = Math.sin((2 * Math.PI * time) / 30);
  return {
    position: { x: -13 + 2.5 * s, y: 1.9 + 0.3 * s, z: 19 },
    target: { x: 1.5, y: 3.2, z: -6 },
    fov: 50,
  };
}
