import type {
  BallState,
  Collider,
  ContactEvent,
  LaunchParams,
  PhysicsEnv,
  SimulateOptions,
  Trajectory,
  Vec3,
} from '../contracts';
import {
  BALL_AREA,
  BALL_MASS,
  BALL_RADIUS,
  CD_CRISIS_SPEED,
  CD_CRISIS_WIDTH,
  CD_MIN,
  CD_RISE,
  DT,
  G,
  MAGNUS_MIN_SPIN,
  REST_SPEED,
  REST_TIME,
  RHO_SEA,
  SPIN_DECAY_TAU,
} from './constants';
import { collideCollider, collideGround } from './collisions';
import { createKnuckleNoise, type KnuckleNoise } from './rng';

const TWO_PI = 2 * Math.PI;

/** Drag crisis: Cd = 0.20 + 0.30 / (1 + e^((|v| − 13) / 2)). */
export function dragCoefficient(speed: number): number {
  return CD_MIN + CD_RISE / (1 + Math.exp((speed - CD_CRISIS_SPEED) / CD_CRISIS_WIDTH));
}

/** Lift coefficient from the spin parameter S = r|ω|/|v|: Cl = 1 / (2 + 1/S), 0 for S ≤ 0. */
export function liftCoefficient(spinParameter: number): number {
  return spinParameter > 0 ? 1 / (2 + 1 / spinParameter) : 0;
}

/**
 * World spin vector (rad/s) from the kicker's spins: ω = 2π(−sideSpin·ŷ − topSpin·r̂), r̂ = (cos az, 0, sin az)
 * the kicker's right-hand horizontal axis. sideSpin > 0 curves to +x, topSpin > 0 dips.
 */
export function spinVector(azimuth: number, sideSpinRps: number, topSpinRps: number): Vec3 {
  return {
    x: -TWO_PI * topSpinRps * Math.cos(azimuth),
    y: -TWO_PI * sideSpinRps,
    z: -TWO_PI * topSpinRps * Math.sin(azimuth),
  };
}

/** Initial state of a kick: t = 0, v along (cos el sin az, sin el, −cos el cos az), ω from spinVector. */
export function launchState(l: LaunchParams): BallState {
  const ce = Math.cos(l.elevation);
  return {
    t: 0,
    p: { x: l.origin.x, y: l.origin.y, z: l.origin.z },
    v: {
      x: l.speed * ce * Math.sin(l.azimuth),
      y: l.speed * Math.sin(l.elevation),
      z: -l.speed * ce * Math.cos(l.azimuth),
    },
    w: spinVector(l.azimuth, l.sideSpin, l.topSpin),
  };
}

/**
 * Acceleration of the ball (m/s²): gravity + drag + Magnus + knuckle.
 *   drag   = −½ρ Cd(|v|) A |v| v / m
 *   Magnus = ½ρ Cl(S) A |v|² (ω × v) / (|ω||v|) / m, S = r|ω|/|v|, zero when |ω| < 0.5 rad/s
 *   knuckle = (ρ/ρ_sea)·k with its component along v removed (k from KnuckleNoise.sample, |k| ≤ 0.25).
 */
export function acceleration(s: BallState, env: PhysicsEnv, knuckle: Vec3): Vec3 {
  const g = env.g ?? G;
  const { v, w } = s;
  const speed = Math.hypot(v.x, v.y, v.z);
  let ax = 0;
  let ay = -g;
  let az = 0;
  if (speed > 0 && env.rho > 0) {
    const q = (0.5 * env.rho * BALL_AREA) / BALL_MASS;
    const kd = q * dragCoefficient(speed) * speed;
    ax -= kd * v.x;
    ay -= kd * v.y;
    az -= kd * v.z;
    const spin = Math.hypot(w.x, w.y, w.z);
    if (spin >= MAGNUS_MIN_SPIN) {
      const cl = liftCoefficient((BALL_RADIUS * spin) / speed);
      const km = (q * cl * speed) / spin; // ½ρClA|v|²/(m|ω||v|)
      ax += km * (w.y * v.z - w.z * v.y);
      ay += km * (w.z * v.x - w.x * v.z);
      az += km * (w.x * v.y - w.y * v.x);
    }
    if (knuckle.x !== 0 || knuckle.y !== 0 || knuckle.z !== 0) {
      const f = env.rho / RHO_SEA;
      const along = (knuckle.x * v.x + knuckle.y * v.y + knuckle.z * v.z) / (speed * speed);
      ax += f * (knuckle.x - along * v.x);
      ay += f * (knuckle.y - along * v.y);
      az += f * (knuckle.z - along * v.z);
    }
  }
  return { x: ax, y: ay, z: az };
}

/**
 * One fixed step. Flight is integrated with classical RK4 on (p, v) — exact for constant acceleration — with
 * the spin decaying exactly as ω(t) = ω₀ e^(−t/τ) inside the step and the knuckle noise sampled at each stage
 * time. Then contacts are resolved: each collider in order (swept), then the ground plane (unless `ground` is
 * false — free-flight measurement only).
 */
export function stepBall(
  s: BallState,
  dt: number,
  env: PhysicsEnv,
  noise: KnuckleNoise,
  colliders: readonly Collider[] = [],
  ground = true,
): { state: BallState; contacts: ContactEvent[] } {
  const t0 = s.t;
  const w0 = s.w;
  const w0mag = Math.hypot(w0.x, w0.y, w0.z);
  const f = (h: number, v: Vec3): Vec3 => {
    const d = Math.exp(-h / SPIN_DECAY_TAU);
    const w = { x: w0.x * d, y: w0.y * d, z: w0.z * d };
    const kn = noise.sample(t0 + h, Math.hypot(v.x, v.y, v.z), w0mag * d);
    return acceleration({ t: t0 + h, p: s.p, v, w }, env, kn);
  };
  const v1 = s.v;
  const a1 = f(0, v1);
  const h2 = dt / 2;
  const v2 = { x: v1.x + a1.x * h2, y: v1.y + a1.y * h2, z: v1.z + a1.z * h2 };
  const a2 = f(h2, v2);
  const v3 = { x: v1.x + a2.x * h2, y: v1.y + a2.y * h2, z: v1.z + a2.z * h2 };
  const a3 = f(h2, v3);
  const v4 = { x: v1.x + a3.x * dt, y: v1.y + a3.y * dt, z: v1.z + a3.z * dt };
  const a4 = f(dt, v4);
  const k = dt / 6;
  const decay = Math.exp(-dt / SPIN_DECAY_TAU);
  let next: BallState = {
    t: t0 + dt,
    p: {
      x: s.p.x + k * (v1.x + 2 * v2.x + 2 * v3.x + v4.x),
      y: s.p.y + k * (v1.y + 2 * v2.y + 2 * v3.y + v4.y),
      z: s.p.z + k * (v1.z + 2 * v2.z + 2 * v3.z + v4.z),
    },
    v: {
      x: v1.x + k * (a1.x + 2 * a2.x + 2 * a3.x + a4.x),
      y: v1.y + k * (a1.y + 2 * a2.y + 2 * a3.y + a4.y),
      z: v1.z + k * (a1.z + 2 * a2.z + 2 * a3.z + a4.z),
    },
    w: { x: w0.x * decay, y: w0.y * decay, z: w0.z * decay },
  };
  const contacts: ContactEvent[] = [];
  for (let i = 0; i < colliders.length; i++) {
    const r = collideCollider(s, next, colliders[i], i, dt);
    next = r.state;
    if (r.contact) contacts.push(r.contact);
  }
  if (!ground) return { state: next, contacts };
  const gr = collideGround(next, dt, env.g ?? G);
  if (gr.contact) contacts.push(gr.contact);
  return { state: gr.state, contacts };
}

/**
 * SimulateOptions plus `ground` (default true). `ground: false` switches off only the ground plane, to measure
 * pure free flight (the §4 acceptance table evaluates flight paths that would pass below y = 0). The game never
 * sets it. Proposed contract addition: `SimulateOptions.ground?: boolean`.
 */
export interface PhysicsSimulateOptions extends SimulateOptions {
  ground?: boolean;
}

/**
 * Simulates a kick from launch with fixed steps of stepBall (the same code path the game uses every 1/240 s).
 * Knuckle noise is seeded from env.seed, so the result is deterministic.
 */
export function simulate(l: LaunchParams, env: PhysicsEnv, opts: PhysicsSimulateOptions = {}): Trajectory {
  const dt = opts.dt ?? DT;
  const maxTime = opts.maxTime ?? 6;
  const every = Math.max(1, Math.floor(opts.sampleEvery ?? 1));
  const stopAtGoalLine = opts.stopAtGoalLine ?? false;
  const stopAtRest = opts.stopAtRest ?? true;
  const ground = opts.ground ?? true;
  const noise = createKnuckleNoise(env.seed);
  let s = launchState(l);
  const samples: BallState[] = [s];
  const contacts: ContactEvent[] = [];
  let lineCrossing: Trajectory['lineCrossing'] = null;
  let still = 0;
  let step = 0;
  while (s.t < maxTime - 1e-9) {
    const r = stepBall(s, dt, env, noise, opts.colliders ? opts.colliders(s.t) : undefined, ground);
    const n = r.state;
    for (const c of r.contacts) contacts.push(c);
    if (!lineCrossing && s.p.z >= 0 && n.p.z < 0) {
      const u = s.p.z / (s.p.z - n.p.z);
      const lerp = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: 0 });
      const v = lerp(s.v, n.v);
      v.z = s.v.z + (n.v.z - s.v.z) * u;
      lineCrossing = { t: s.t + (n.t - s.t) * u, p: lerp(s.p, n.p), v };
    }
    s = n;
    step++;
    still = Math.hypot(s.v.x, s.v.y, s.v.z) < REST_SPEED ? still + dt : 0;
    const stop = (stopAtGoalLine && lineCrossing !== null) || (stopAtRest && still >= REST_TIME - 1e-9);
    if (step % every === 0 || stop) samples.push(s);
    if (stop) break;
  }
  if (samples[samples.length - 1] !== s) samples.push(s);
  return { samples, contacts, lineCrossing };
}
