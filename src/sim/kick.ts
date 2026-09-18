// Intent → launch: power→speed, aim (solver or angles), power scatter and run-up timing penalty.
import type { KickIntent, LaunchParams, PhysicsEnv, Vec3 } from '../contracts';
import { solveLaunch } from '../physics';
import { DEG, KMH, clamp } from './vec';

const G = 9.81;

/** Ball speed for a power in [0, 1]: 40 + 75·power km/h, returned in m/s. */
export function speedFromPower(power: number): number {
  return (40 + 75 * clamp(power, 0, 1)) * KMH;
}

/** Aim scatter σ (degrees) from power: none below 90 %, 1.5° at 90 % rising linearly to 3.5° at 100 %. */
export function powerScatterDeg(power: number): number {
  const p = clamp(power, 0, 1);
  return p >= 0.9 ? 1.5 + 20 * (p - 0.9) : 0;
}

export const TIMING_WINDOW_MS = 80;
export const TIMING_FULL_MS = 400;

/**
 * Run-up timing → ball-speed multiplier and extra aim σ.
 * Penalty run-up (ARCHITECTURE §2): within ±80 ms full speed; beyond, the multiplier falls linearly to 0.75 at
 * 400 ms. Long shot (brief §1.1 "early/late costs 10–25 %"): outside ±80 ms it starts at 0.90 and falls linearly to
 * 0.75 at 400 ms. Extra σ rises linearly from 0 to 3° at 400 ms in both; everything is clamped beyond 400 ms.
 */
export function timingPenalty(
  errMs: number,
  kind: 'runUp' | 'longShot' = 'runUp',
): { speedMult: number; sigmaDeg: number } {
  const a = Math.abs(errMs);
  if (!Number.isFinite(a) || a <= TIMING_WINDOW_MS) return { speedMult: 1, sigmaDeg: 0 };
  const f = Math.min(1, (a - TIMING_WINDOW_MS) / (TIMING_FULL_MS - TIMING_WINDOW_MS));
  const speedMult = kind === 'longShot' ? 0.9 - 0.15 * f : 1 - 0.25 * f;
  return { speedMult, sigmaDeg: 3 * f };
}

/** Straight-at-the-target launch used when the solver cannot reach the target (a mis-aim must still be possible). */
export function fallbackAim(
  origin: Vec3,
  target: { x: number; y: number },
  speed: number,
): { azimuth: number; elevation: number } {
  const dx = target.x - origin.x;
  const dz = origin.z;
  const d = Math.max(Math.hypot(dx, dz), 0.5);
  const lob = 0.5 * Math.asin(clamp((G * d) / Math.max(speed * speed, 1e-6), 0, 1));
  return { azimuth: Math.atan2(dx, dz), elevation: clamp(Math.atan2(target.y - origin.y, d) + lob, -0.1, 0.8) };
}

/** Lowest aimable target: the ball centre cannot cross the line below its radius. */
export const MIN_TARGET_Y = 0.11;

/**
 * Deterministic part of the resolution (no scatter). `speedMult` is the timing multiplier on the kick speed;
 * `ballVel` is the velocity of a moving ball (long shot), which adds to the kick.
 * Target aim with a moving ball: the RESULTING launch (kick + ball velocity) is solved to reach the target, with
 * its speed chosen so that the foot's contribution |resultant − ballVel| equals the kick speed.
 */
export function resolveLaunch(
  intent: KickIntent,
  origin: Vec3,
  ballVel: Vec3,
  speedMult: number,
  env: PhysicsEnv,
): LaunchParams {
  const kickSpeed = speedFromPower(intent.power) * speedMult;
  const sideSpin = clamp(intent.sideSpin, -10, 10);
  const topSpin = clamp(intent.topSpin, -6, 6);
  const o = { x: origin.x, y: origin.y, z: origin.z };
  if (intent.aim.kind === 'target') {
    const t = { x: intent.aim.x, y: Math.max(MIN_TARGET_Y, intent.aim.y) };
    const moving = Math.hypot(ballVel.x, ballVel.y, ballVel.z) > 1e-9;
    let speed = kickSpeed;
    if (moving) {
      const dx = t.x - o.x;
      const dz = -o.z;
      const dl = Math.hypot(dx, dz) || 1;
      speed = Math.max(1, kickSpeed + (ballVel.x * dx + ballVel.z * dz) / dl);
    }
    let a: { azimuth: number; elevation: number } = fallbackAim(o, t, speed);
    for (let it = 0; it < 6; it++) {
      a = solveLaunch(o, t, speed, sideSpin, topSpin, env) ?? fallbackAim(o, t, speed);
      if (!moving || it === 5) break;
      const ce = Math.cos(a.elevation);
      const kx = speed * ce * Math.sin(a.azimuth) - ballVel.x;
      const ky = speed * Math.sin(a.elevation) - ballVel.y;
      const kz = -speed * ce * Math.cos(a.azimuth) - ballVel.z;
      const err = kickSpeed - Math.hypot(kx, ky, kz);
      if (Math.abs(err) < 0.01) break;
      speed = Math.max(1, speed + err);
    }
    return { origin: o, speed, azimuth: a.azimuth, elevation: a.elevation, sideSpin, topSpin };
  }
  const { azimuth, elevation } = intent.aim;
  const ce = Math.cos(elevation);
  const vx = kickSpeed * ce * Math.sin(azimuth) + ballVel.x;
  const vy = kickSpeed * Math.sin(elevation) + ballVel.y;
  const vz = -kickSpeed * ce * Math.cos(azimuth) + ballVel.z;
  return {
    origin: o,
    speed: Math.hypot(vx, vy, vz),
    azimuth: Math.atan2(vx, -vz),
    elevation: Math.atan2(vy, Math.hypot(vx, vz)),
    sideSpin,
    topSpin,
  };
}

/** Applies Gaussian aim scatter (σ in degrees) using two standard normal draws. */
export function applyScatter(l: LaunchParams, sigmaDeg: number, g1: number, g2: number): LaunchParams {
  if (sigmaDeg <= 0) return l;
  return { ...l, azimuth: l.azimuth + sigmaDeg * DEG * g1, elevation: l.elevation + sigmaDeg * DEG * g2 };
}
