// Goalkeeper model: reaction time, run-up read (penalty), acceleration-limited dive inside a reach envelope,
// hands as spheres + body capsule for collisions.
import type { Collider, KeeperPose, Vec3 } from '../contracts';
import { clamp, v3 } from './vec';

export const KEEPER = {
  /** Lateral reach of the hand centres from the set position, m (brief: ≈2.9 m either side). */
  reachX: 2.9,
  /** Highest hand centre, m (brief: ≈2.2 m). */
  reachTop: 2.2,
  /** Reach envelope: superellipse |dx/2.9|⁴ + |(y − 1.0)/1.2|⁴ ≤ 1, y ≥ 0.15. */
  envCentreY: 1.0,
  envPower: 4,
  minHandY: 0.15,
  restHandY: 1.15,
  handRadius: 0.12,
  /** Each hand centre sits this far either side of the hands' mid-point, across the arms. */
  handSpread: 0.13,
  bodyRadius: 0.22,
  /** Hip-to-shoulder-top segment of the body capsule, m (plus the radius ≈ 1.9 m tall). */
  bodyLength: 1.45,
  hipY: 0.25,
  /** Max lateral step of the feet from the set position, m. */
  footTravel: 0.9,
  /** Max distance of the hands' mid-point from the hip point, m. */
  armReach: 2.3,
  /** Full dive (after reaction): lateral acceleration, top speed, braking (m/s², m/s, m/s²). */
  lateral: { a: 24, v: 7.5, brake: 60 },
  vertical: { a: 30, v: 5, brake: 60 },
  /** Anticipation shift towards the guessed side before the reaction time. */
  pre: { a: 8, v: 1.8, brake: 60 },
  feet: { a: 10, v: 3.5, brake: 20 },
  /** Side-steps of the whole set position when the ball is heading beyond the reach (slow, long shots). */
  shuffle: { a: 8, v: 3, brake: 20 },
  /** The keeper side-steps only to keep the target this far inside his lateral reach, m. */
  shuffleMargin: 0.3,
  /** A contact slower than this is caught (60 km/h). */
  catchSpeed: 60 / 3.6,
  handRestitution: 0.45,
  bodyRestitution: 0.35,
  /** Reaction time window after the strike, s. */
  reactionMin: 0.2,
  reactionMax: 0.25,
  /** Probability the keeper follows the run-up cue. */
  readProbability: 0.65,
  /** Re-predict the ball every this many seconds. */
  replanEvery: 0.05,
} as const;

const HALF_Y = KEEPER.reachTop - KEEPER.envCentreY;

/** Envelope measure: ≤ 1 inside. dx is relative to the keeper's set position. */
export function envelopeMeasure(dx: number, y: number): number {
  return (
    Math.abs(dx / KEEPER.reachX) ** KEEPER.envPower + Math.abs((y - KEEPER.envCentreY) / HALF_Y) ** KEEPER.envPower
  );
}

/** Largest lateral hand reach at height y. */
export function lateralReachAt(y: number): number {
  const q = Math.min(1, Math.abs((Math.max(y, KEEPER.minHandY) - KEEPER.envCentreY) / HALF_Y) ** KEEPER.envPower);
  return KEEPER.reachX * (1 - q) ** (1 / KEEPER.envPower);
}

/** Clamp a hand target (absolute x, y) into the reach envelope around the set position xs. */
export function clampToEnvelope(xs: number, x: number, y: number): { x: number; y: number } {
  let dx = x - xs;
  let dy = Math.max(y, KEEPER.minHandY) - KEEPER.envCentreY;
  const m = envelopeMeasure(dx, dy + KEEPER.envCentreY);
  if (m <= 1) return { x, y: Math.max(y, KEEPER.minHandY) };
  {
    const k = m ** (1 / KEEPER.envPower);
    dx /= k;
    dy /= k;
  }
  return { x: xs + dx, y: Math.max(KEEPER.minHandY, dy + KEEPER.envCentreY) };
}

/** Which side the keeper guesses: the run-up cue with probability 0.65, otherwise another option. */
export function keeperGuess(aimSide: -1 | 0 | 1, disguise: boolean, u: number): -1 | 0 | 1 {
  const cue: -1 | 0 | 1 = disguise ? ((-aimSide || 1) as -1 | 1) : aimSide;
  if (u < KEEPER.readProbability) return cue;
  const w = (u - KEEPER.readProbability) / (1 - KEEPER.readProbability);
  if (cue === 0) return w < 0.5 ? -1 : 1;
  return -cue as -1 | 1;
}

export function reactionTime(u: number): number {
  return KEEPER.reactionMin + (KEEPER.reactionMax - KEEPER.reactionMin) * u;
}

export interface KeeperPlan {
  reaction: number;
  guessSide: -1 | 0 | 1;
}

/** Predicted ball path: where it crosses the keeper plane and the goal line (either may be null). */
export interface Prediction {
  plane: { x: number; y: number } | null;
  line: { x: number; y: number } | null;
}

interface Axis {
  a: number;
  v: number;
  brake: number;
}

function moveAxis(pos: number, vel: number, target: number, ax: Axis, dt: number): [number, number] {
  const d = target - pos;
  const vdes = Math.sign(d) * Math.min(ax.v, Math.sqrt(2 * ax.brake * Math.abs(d)));
  // Braking (arriving at the target while moving towards it) is quick; reversing a movement costs a full push-off.
  const braking = Math.sign(vdes) === Math.sign(vel) && Math.abs(vdes) < Math.abs(vel);
  const dvMax = (braking ? ax.brake : ax.a) * dt;
  const nv = vel + clamp(vdes - vel, -dvMax, dvMax);
  return [pos + nv * dt, nv];
}

export interface KeeperStepResult {
  dive: { side: -1 | 0 | 1; target: Vec3 } | null;
}

export class Keeper {
  hx = 0;
  hy: number = KEEPER.restHandY;
  vx = 0;
  vy = 0;
  f = 0;
  vf = 0;
  /** Current set position (moves only by side-steps); the reach envelope is centred on it. */
  base = 0;
  vb = 0;
  private plan: KeeperPlan | null = null;
  private t = 0;
  private target: { x: number; y: number } | null = null;
  private dived = false;
  private want: number | null = null;
  private sinceReplan = Infinity;

  constructor(
    public xs: number,
    public z: number,
  ) {
    this.reset();
  }

  setPosition(xs: number, z: number): void {
    this.xs = xs;
    this.z = z;
    this.reset();
  }

  reset(): void {
    this.hx = this.xs;
    this.hy = KEEPER.restHandY;
    this.vx = 0;
    this.vy = 0;
    this.f = this.xs;
    this.vf = 0;
    this.base = this.xs;
    this.vb = 0;
    this.plan = null;
    this.t = 0;
    this.target = null;
    this.dived = false;
    this.want = null;
    this.sinceReplan = Infinity;
  }

  /** Called at the strike. */
  strike(plan: KeeperPlan): void {
    this.plan = plan;
    this.t = 0;
  }

  /** The ball is held: stop the dive and recover to the set position with it. */
  freeze(): void {
    this.plan = null;
    this.target = null;
    this.want = null;
    this.vx = 0;
    this.vy = 0;
    this.vf = 0;
    this.vb = 0;
  }

  get reacting(): boolean {
    return !!this.plan && this.t >= this.plan.reaction;
  }

  step(dt: number, predict: () => Prediction): KeeperStepResult {
    let dive: KeeperStepResult['dive'] = null;
    let hand: { x: number; y: number } = { x: this.base, y: KEEPER.restHandY };
    let lat: Axis = KEEPER.lateral;
    let baseTarget = this.base;
    if (this.plan) {
      this.t += dt;
      if (this.t < this.plan.reaction) {
        if (this.plan.guessSide !== 0) {
          hand = clampToEnvelope(this.base, this.base + this.plan.guessSide * KEEPER.reachX, KEEPER.envCentreY);
          lat = KEEPER.pre;
        }
      } else {
        this.sinceReplan += dt;
        if (this.sinceReplan >= KEEPER.replanEvery - 1e-9) {
          this.sinceReplan = 0;
          const p = predict();
          this.target = this.decide(p);
          this.want = p.plane ? this.target.x : null;
          if (!this.dived) {
            this.dived = true;
            const t = this.clampHand(this.target);
            const dx = t.x - this.xs;
            dive = { side: Math.abs(dx) < 0.3 ? 0 : dx < 0 ? -1 : 1, target: v3(t.x, t.y, this.z) };
          }
        }
        if (this.target) hand = this.clampHand(this.target);
        if (this.want !== null) {
          const need = this.want - this.base;
          const lim = lateralReachAt(this.target ? this.target.y : KEEPER.envCentreY) - KEEPER.shuffleMargin;
          if (Math.abs(need) > lim) baseTarget = this.want - Math.sign(need) * lim;
        }
      }
    }
    [this.base, this.vb] = moveAxis(this.base, this.vb, baseTarget, KEEPER.shuffle, dt);
    [this.hx, this.vx] = moveAxis(this.hx, this.vx, hand.x, lat, dt);
    [this.hy, this.vy] = moveAxis(this.hy, this.vy, hand.y, KEEPER.vertical, dt);
    const footTarget = this.base + clamp(hand.x - this.base, -KEEPER.footTravel, KEEPER.footTravel);
    [this.f, this.vf] = moveAxis(this.f, this.vf, footTarget, KEEPER.feet, dt);
    this.constrain();
    return { dive };
  }

  /** Unclamped hand target in the goal plane (the envelope is applied every step around the moving base). */
  private decide(p: Prediction): { x: number; y: number } {
    const rest: { x: number; y: number } = { x: this.base, y: KEEPER.restHandY };
    if (!p.plane) return this.target ?? rest;
    const line = p.line;
    if (line && (Math.abs(line.x) > 3.66 + 0.5 || line.y > 2.44 + 0.5)) {
      // Clearly off target: cover the near post / bar rather than diving at it.
      return { x: clamp(line.x, -3.2, 3.2), y: Math.min(line.y, 2.0) };
    }
    return { x: p.plane.x, y: p.plane.y };
  }

  private clampHand(t: { x: number; y: number }): { x: number; y: number } {
    return clampToEnvelope(this.base, t.x, t.y);
  }

  private constrain(): void {
    const c = clampToEnvelope(this.base, this.hx, this.hy);
    if (c.x !== this.hx) this.vx = 0;
    if (c.y !== this.hy) this.vy = 0;
    this.hx = c.x;
    this.hy = c.y;
    const dx = this.hx - this.f;
    const dy = this.hy - KEEPER.hipY;
    const d = Math.hypot(dx, dy);
    if (d > KEEPER.armReach) {
      this.hx = this.f + (dx / d) * KEEPER.armReach;
      this.hy = KEEPER.hipY + (dy / d) * KEEPER.armReach;
    }
  }

  private lean(): number {
    return clamp(Math.atan2(this.hx - this.f, Math.max(this.hy - KEEPER.hipY, 0)), -Math.PI / 2, Math.PI / 2);
  }

  hands(): [Vec3, Vec3] {
    const dx = this.hx - this.f;
    const dy = this.hy - KEEPER.hipY;
    const d = Math.hypot(dx, dy) || 1;
    const px = (-dy / d) * KEEPER.handSpread;
    const py = (dx / d) * KEEPER.handSpread;
    return [v3(this.hx - px, this.hy - py, this.z), v3(this.hx + px, this.hy + py, this.z)];
  }

  pose(): KeeperPose {
    const lean = this.lean();
    return {
      p: v3(this.f, 0, this.z),
      lean,
      lift: Math.max(0, this.hy - 1.95),
      hands: this.hands(),
    };
  }

  colliders(): Collider[] {
    const lean = this.lean();
    const [h1, h2] = this.hands();
    const hv = v3(this.vx, this.vy, 0);
    const a = v3(this.f, KEEPER.hipY, this.z);
    const b = v3(this.f + Math.sin(lean) * KEEPER.bodyLength, KEEPER.hipY + Math.cos(lean) * KEEPER.bodyLength, this.z);
    return [
      {
        kind: 'sphere',
        tag: 'keeperHand',
        center: h1,
        radius: KEEPER.handRadius,
        restitution: KEEPER.handRestitution,
        velocity: hv,
      },
      {
        kind: 'sphere',
        tag: 'keeperHand',
        center: h2,
        radius: KEEPER.handRadius,
        restitution: KEEPER.handRestitution,
        velocity: hv,
      },
      {
        kind: 'capsule',
        tag: 'keeperBody',
        a,
        b,
        radius: KEEPER.bodyRadius,
        restitution: KEEPER.bodyRestitution,
        velocity: v3((this.vx + this.vf) / 2, this.vy / 2, 0),
      },
    ];
  }
}
