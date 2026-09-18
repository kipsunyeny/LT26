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

/** Allocates a pose to be reused as an `out` argument. */
export function newPose(): CameraPose {
  return { position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 }, fov: 46 };
}

/**
 * Screen height of the resting ball for a viewport height (CSS px): NDC −0.55 at ≥ 622 px (1280×800 framing),
 * raised on short screens so the ball keeps ≥ 140 px above the bottom HUD, never above NDC −0.4.
 */
export function kickBallNdcY(heightPx: number): number {
  if (!(heightPx > 0)) return KICK_CAMERA.ballNdcY;
  return Math.min(-0.4, Math.max(KICK_CAMERA.ballNdcY, 280 / heightPx - 1));
}

/**
 * Kick camera: behind the ball on the ball→goal line, raised, shifted away from the taker.
 * Yaw looks at the goal centre; pitch is chosen so the ball lands at `ballNdcY`,
 * which keeps the goal in the upper-middle of the frame at every distance (11–35 m).
 */
export function kickCameraPose(
  ball: Vec3,
  side: -1 | 1,
  ballNdcY: number = KICK_CAMERA.ballNdcY,
  out: CameraPose = newPose(),
): CameraPose {
  const d = ballToGoalDir(ball);
  const rx = -d.z;
  const rz = d.x;
  const lateral = -side * KICK_CAMERA.side;
  const px = ball.x - d.x * KICK_CAMERA.back + rx * lateral;
  const py = KICK_CAMERA.height;
  const pz = ball.z - d.z * KICK_CAMERA.back + rz * lateral;
  // Yaw towards the goal centre.
  const gx = GOAL_CENTRE.x - px;
  const gz = GOAL_CENTRE.z - pz;
  const gLen = Math.hypot(gx, gz) || 1;
  const fx = gx / gLen;
  const fz = gz / gLen;
  // Angle of the ball below the horizon, measured along the view direction.
  const ballDepth = (ball.x - px) * fx + (ball.z - pz) * fz;
  const ballDrop = Math.atan2(py - Math.max(ball.y, 0.11), Math.max(ballDepth, 0.5));
  const offset = Math.atan(-ballNdcY * Math.tan((KICK_CAMERA.fov / 2) * DEG));
  const pitchDown = ballDrop - offset;
  const cp = Math.cos(pitchDown);
  out.position.x = px;
  out.position.y = py;
  out.position.z = pz;
  out.target.x = px + fx * cp * 10;
  out.target.y = py - Math.sin(pitchDown) * 10;
  out.target.z = pz + fz * cp * 10;
  out.fov = KICK_CAMERA.fov;
  return out;
}

/** Tuning of the kick-camera anchor (the resting spot the camera stands behind). */
export const KICK_ANCHOR = {
  /** Ball speed (m/s) below which it counts as resting. */
  restSpeed: 1,
  /** Above this speed the ball has been struck: the anchor freezes until it rests beside the taker again. */
  strikeSpeed: 10,
  /** Max ball height (m) for "on the ground". */
  groundY: 0.25,
  /** Taker within this horizontal distance (m) of a resting ball ⇒ it is the kick spot. */
  takerNear: 4,
  /** Taker within this distance of a rolling ball ⇒ long-shot push being chased. */
  takerChase: 8,
  /** Resting spot moved more than this (m) ⇒ jump instead of glide (Next kick / preset change). */
  jump: 2,
  /** Glide time constant (s) for small spot adjustments. */
  tau: 0.25,
} as const;

/**
 * Decides where the kick camera stands. Rules:
 *  - ball resting on the ground beside the taker ⇒ that is the kick spot (snap on request or big jumps, else glide);
 *  - ball rolling slowly on the ground with the taker chasing (long-shot push) ⇒ follow it exactly;
 *  - ball struck (fast) ⇒ freeze until it rests beside the taker again (never follow a shot, never a ball in the net);
 *  - no spot known yet ⇒ derive one from the taker's position.
 */
export class KickAnchorTracker {
  readonly anchor: Vec3 = { x: 0, y: 0.11, z: 0 };
  side: -1 | 1 = -1;
  private has = false;
  private snapWanted = true;
  private struck = false;
  private readonly last: Vec3 = { x: 0, y: 0, z: 0 };
  private haveLast = false;

  get valid(): boolean {
    return this.has;
  }

  /** Snap to the kick spot as soon as the ball is seen resting beside the taker. */
  requestSnap(): void {
    this.snapWanted = true;
    this.haveLast = false;
  }

  /** Feeds one frame. dt = time since the previous frame on the snapshot clock (render dt if it did not advance). */
  update(ball: Vec3, taker: Vec3, dt: number): void {
    let speed = 0;
    if (this.haveLast) {
      speed = dt > 0 ? Math.hypot(ball.x - this.last.x, ball.y - this.last.y, ball.z - this.last.z) / dt : 0;
    }
    this.last.x = ball.x;
    this.last.y = ball.y;
    this.last.z = ball.z;
    this.haveLast = true;
    const takerDist = Math.hypot(taker.x - ball.x, taker.z - ball.z);
    const onGround = ball.y < KICK_ANCHOR.groundY;
    if (speed >= KICK_ANCHOR.strikeSpeed) this.struck = true;

    if (onGround && speed < KICK_ANCHOR.restSpeed && takerDist < KICK_ANCHOR.takerNear) {
      const moved = this.has ? Math.hypot(ball.x - this.anchor.x, ball.z - this.anchor.z) : Infinity;
      if (this.snapWanted || moved > KICK_ANCHOR.jump) {
        this.set(ball.x, ball.z);
      } else {
        const k = dt > 0 ? 1 - Math.exp(-dt / KICK_ANCHOR.tau) : 0;
        this.set(this.anchor.x + (ball.x - this.anchor.x) * k, this.anchor.z + (ball.z - this.anchor.z) * k);
      }
      this.side = takerSide(this.anchor, taker);
      this.snapWanted = false;
      this.struck = false;
      return;
    }
    if (
      !this.struck &&
      !this.snapWanted &&
      this.has &&
      onGround &&
      speed < KICK_ANCHOR.strikeSpeed &&
      takerDist < KICK_ANCHOR.takerChase
    ) {
      // Long-shot push: stay exactly behind the rolling ball so it keeps its size for the strike.
      this.set(ball.x, ball.z);
      return;
    }
    if (!this.has) {
      // Nothing known: assume a right-footer standing 0.7 m left of / 0.5 m behind the spot.
      const d = ballToGoalDir(taker);
      this.set(taker.x + d.x * 0.5 - d.z * 0.7, taker.z + d.z * 0.5 + d.x * 0.7);
      this.side = -1;
    }
  }

  private set(x: number, z: number): void {
    this.anchor.x = x;
    this.anchor.y = 0.11;
    this.anchor.z = z;
    this.has = true;
  }
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
export function replayCameraPose(b: PathBounds, time: number, aspect: number, out: CameraPose = newPose()): CameraPose {
  const vHalf = (REPLAY_CAMERA.fov / 2) * DEG;
  const hHalf = Math.atan(Math.tan(vHalf) * Math.max(aspect, 0.2));
  const dist = (b.radius / Math.sin(Math.min(vHalf, hHalf))) * 1.02;
  const side = b.start.x > 0.5 ? -1 : 1;
  const az =
    (REPLAY_CAMERA.azimuth + REPLAY_CAMERA.sweep * Math.sin((2 * Math.PI * time) / REPLAY_CAMERA.period)) * DEG;
  const el = REPLAY_CAMERA.elevation * DEG;
  const horiz = dist * Math.cos(el);
  out.position.x = b.center.x + side * Math.sin(az) * horiz;
  out.position.y = Math.max(2, b.center.y + dist * Math.sin(el));
  out.position.z = b.center.z + Math.cos(az) * horiz;
  out.target.x = b.center.x;
  out.target.y = b.center.y;
  out.target.z = b.center.z;
  out.fov = REPLAY_CAMERA.fov;
  return out;
}

/** Title: low dramatic view from the edge of the box towards the goal and the main stand, gently drifting. */
export function titleCameraPose(time: number, out: CameraPose = newPose()): CameraPose {
  const s = Math.sin((2 * Math.PI * time) / 30);
  out.position.x = -13 + 2.5 * s;
  out.position.y = 1.9 + 0.3 * s;
  out.position.z = 19;
  out.target.x = 1.5;
  out.target.y = 3.2;
  out.target.z = -6;
  out.fov = 50;
  return out;
}
