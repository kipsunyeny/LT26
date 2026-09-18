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

/** Run-up timing: within ±80 ms full power; beyond, power × down to 0.75 and extra σ up to 3° at 400 ms. */
export function timingPenalty(errMs: number): { powerMult: number; sigmaDeg: number } {
  const a = Math.abs(errMs);
  if (!Number.isFinite(a) || a <= TIMING_WINDOW_MS) return { powerMult: 1, sigmaDeg: 0 };
  const f = Math.min(1, (a - TIMING_WINDOW_MS) / (TIMING_FULL_MS - TIMING_WINDOW_MS));
  return { powerMult: 1 - 0.25 * f, sigmaDeg: 3 * f };
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

/**
 * Deterministic part of the resolution (no scatter). `powerMult` is the timing multiplier; `ballVel` is the
 * velocity of a moving ball (long shot), which adds to the kick.
 */
export function resolveLaunch(
  intent: KickIntent,
  origin: Vec3,
  ballVel: Vec3,
  powerMult: number,
  env: PhysicsEnv,
): LaunchParams {
  const kickSpeed = speedFromPower(clamp(intent.power, 0, 1) * powerMult);
  const sideSpin = clamp(intent.sideSpin, -10, 10);
  const topSpin = clamp(intent.topSpin, -6, 6);
  const o = { x: origin.x, y: origin.y, z: origin.z };
  if (intent.aim.kind === 'target') {
    const t = { x: intent.aim.x, y: intent.aim.y };
    const dx = t.x - o.x;
    const dz = -o.z;
    const dl = Math.hypot(dx, dz) || 1;
    const along = (ballVel.x * dx + ballVel.z * dz) / dl;
    const speed = Math.max(1, kickSpeed + along);
    const solved = solveLaunch(o, t, speed, sideSpin, topSpin, env);
    const a = solved ?? fallbackAim(o, t, speed);
    return { origin: o, speed, azimuth: a.azimuth, elevation: a.elevation, sideSpin, topSpin };
  }
  const { azimuth, elevation } = intent.aim;
  const ce = Math.cos(elevation);
  const vx = kickSpeed * ce * Math.sin(azimuth) + ballVel.x;
  const vy = kickSpeed * Math.sin(elevation) + ballVel.y;
  const vz = -kickSpeed * ce * Math.cos(azimuth) + ballVel.z;
  const speed = Math.hypot(vx, vy, vz);
  return {
    origin: o,
    speed,
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
