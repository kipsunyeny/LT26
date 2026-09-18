import type { LaunchParams, PhysicsEnv, Vec3 } from '../contracts';
import { simulate } from './ball';
import { BALL_RADIUS, G } from './constants';

/** Converged when the crossing is within this distance of the target, m. */
const TOLERANCE = 0.005;
const MAX_ITERATIONS = 14;
/** Finite-difference step for the Jacobian, rad. */
const FD = 1e-4;
/** Largest Newton step per iteration, rad. */
const MAX_STEP = 0.25;
const MIN_ELEVATION = -0.35;
const MAX_ELEVATION = 1.3;

type Residual = { x: number; y: number } | null;

/**
 * Aim assist: finds azimuth and elevation such that the ball launched from `origin` with the given speed and
 * spins crosses the goal plane z = 0 with its centre at `target` (x, y), using the SAME simulate() the game
 * uses, without colliders and in free flight (a direct flight to a centre height ≥ r never touches the ground
 * before the line, and free flight keeps the residual smooth for trial steps that would bounce).
 * Newton's method on (azimuth, elevation) started from the vacuum low-trajectory solution: forward-difference
 * Jacobian, then Broyden rank-1 updates on accepted steps (refreshed by finite differences when a step fails);
 * steps are capped and halved until the miss shrinks. Returns null when it cannot get within 5 mm
 * (unreachable target, or a target centre below the ball radius).
 */
export function solveLaunch(
  origin: Vec3,
  target: { x: number; y: number },
  speed: number,
  sideSpin: number,
  topSpin: number,
  env: PhysicsEnv,
): LaunchParams | null {
  if (!(speed > 0) || !(origin.z > 0) || target.y < BALL_RADIUS - 1e-9) return null;
  const launch = (azimuth: number, elevation: number): LaunchParams => ({
    origin: { x: origin.x, y: origin.y, z: origin.z },
    speed,
    azimuth,
    elevation,
    sideSpin,
    topSpin,
  });
  const maxTime = Math.min(6, (4 * Math.hypot(origin.z, target.x - origin.x)) / speed + 1);
  const residual = (az: number, el: number): Residual => {
    const c = simulate(launch(az, el), env, {
      stopAtGoalLine: true,
      sampleEvery: 1 << 30,
      maxTime,
      ground: false,
    }).lineCrossing;
    return c ? { x: c.p.x - target.x, y: c.p.y - target.y } : null;
  };

  // Vacuum low-trajectory guess.
  const g = env.g ?? G;
  const dx = target.x - origin.x;
  const d = Math.hypot(dx, origin.z);
  const h = target.y - origin.y;
  const v2 = speed * speed;
  const disc = v2 * v2 - g * (g * d * d + 2 * h * v2);
  let az = Math.atan2(dx, origin.z);
  let el = disc >= 0 ? Math.atan((v2 - Math.sqrt(disc)) / (g * d)) : Math.PI / 4;
  let r = residual(az, el);
  if (!r) return null;

  // Jacobian [[j11, j12], [j21, j22]] = ∂(rx, ry)/∂(az, el).
  let j11 = 0;
  let j12 = 0;
  let j21 = 0;
  let j22 = 0;
  let fresh = false;
  const refresh = (): boolean => {
    if (!r) return false;
    const ra = residual(az + FD, el);
    const re = residual(az, el + FD);
    if (!ra || !re) return false;
    j11 = (ra.x - r.x) / FD;
    j21 = (ra.y - r.y) / FD;
    j12 = (re.x - r.x) / FD;
    j22 = (re.y - r.y) / FD;
    fresh = true;
    return true;
  };
  if (!refresh()) return null;

  for (let it = 0; it < MAX_ITERATIONS; it++) {
    const err = Math.hypot(r.x, r.y);
    if (err < TOLERANCE) return launch(az, el);
    const det = j11 * j22 - j12 * j21;
    if (!Number.isFinite(det) || Math.abs(det) < 1e-9) {
      if (fresh || !refresh()) return null;
      continue;
    }
    let sa: number = -(j22 * r.x - j12 * r.y) / det;
    let se: number = -(-j21 * r.x + j11 * r.y) / det;
    const len = Math.hypot(sa, se);
    if (len > MAX_STEP) {
      sa *= MAX_STEP / len;
      se *= MAX_STEP / len;
    }
    let next: { az: number; el: number; r: { x: number; y: number } } | null = null;
    for (let k = 0; k < 6 && !next; k++) {
      const na: number = az + sa;
      const ne: number = Math.min(MAX_ELEVATION, Math.max(MIN_ELEVATION, el + se));
      const nr = residual(na, ne);
      if (nr && Math.hypot(nr.x, nr.y) < err) next = { az: na, el: ne, r: nr };
      else if (!fresh)
        break; // a stale Broyden Jacobian: refresh it before shrinking the step
      else {
        sa /= 2;
        se /= 2;
      }
    }
    if (!next) {
      if (fresh || !refresh()) return null;
      continue;
    }
    // Broyden's good update: J += (Δr − J Δx) Δxᵀ / |Δx|².
    const da = next.az - az;
    const de = next.el - el;
    const n2 = da * da + de * de;
    const ux = next.r.x - r.x - (j11 * da + j12 * de);
    const uy = next.r.y - r.y - (j21 * da + j22 * de);
    j11 += (ux * da) / n2;
    j12 += (ux * de) / n2;
    j21 += (uy * da) / n2;
    j22 += (uy * de) / n2;
    az = next.az;
    el = next.el;
    r = next.r;
    fresh = false;
  }
  return Math.hypot(r.x, r.y) < TOLERANCE ? launch(az, el) : null;
}
