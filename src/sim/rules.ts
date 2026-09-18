// Goal / save / miss detection and shot statistics. Fed one physics step at a time; knows nothing about modes.
import type { BallState, ContactEvent, LaunchParams, Mode, ShotResult, ShotSummary, Vec3 } from '../contracts';
import { copy, len } from './vec';

export const GOAL_HALF_WIDTH = 3.66;
export const GOAL_HEIGHT = 2.44;
export const BALL_R = 0.11;
/** The decision is forced this long after the strike, s. */
export const SHOT_TIMEOUT = 6;
/** Ball "stopped" below this speed, m/s. */
const STOP_SPEED = 0.2;
/** Down-sample the 240 Hz path to 60 Hz. */
const PATH_EVERY = 4;
/** After a block, a ball moving away from goal for this long is decided, s. */
export const AWAY_DECIDE_S = 0.5;

/** Distance from a point on the goal plane (x, y) to the goal-mouth rectangle [−3.66, 3.66] × [0, 2.44]. */
export function mouthDistance(x: number, y: number): number {
  const dx = Math.max(0, Math.abs(x) - GOAL_HALF_WIDTH);
  const dy = Math.max(0, y - GOAL_HEIGHT, -y);
  return Math.hypot(dx, dy);
}

/** 3D distance from a point to the goal-mouth rectangle (in the plane z = 0). */
export function mouthDistance3(p: Vec3): number {
  return Math.hypot(mouthDistance(p.x, p.y), p.z);
}

export interface Decision {
  result: ShotResult;
  t: number;
}

export interface LineCross {
  t: number;
  x: number;
  y: number;
  inside: boolean;
}

export interface JudgeStep {
  lineCross: LineCross | null;
  decision: Decision | null;
}

/**
 * Tracks one shot from the strike. Times are flight times (s since the strike).
 * Goal: the ball wholly over the line (centre z < −0.11) inside the posts and under the bar — also after touching
 * the frame or the keeper. Otherwise, when the ball is decided (crossed the line outside, caught, stopped, left the
 * play area, was blocked and has been heading back upfield for 0.5 s, or 6 s passed): caught > saved (keeper touched) > post/bar (frame touched) > wall (wall/defender) > miss.
 */
export class ShotJudge {
  private crossing: LineCross | null = null;
  private frameTag: 'post' | 'bar' | null = null;
  private keeperTouched = false;
  private wallTouched = false;
  private firstBlockT: number | null = null;
  private keeperT: number | null = null;
  private wallT: number | null = null;
  private apex: number;
  private lateral = 0;
  private freeFlight = true;
  private closest: number;
  private stepCount = 0;
  private awayFor = 0;
  readonly path: Vec3[];
  decision: Decision | null = null;

  constructor(
    readonly mode: Mode,
    readonly spotKey: string,
    readonly launch: LaunchParams,
    /** Where the ball would have crossed z = 0 in free flight (no players, no frame), or null. */
    readonly predicted: { x: number; y: number } | null = null,
  ) {
    this.apex = launch.origin.y;
    this.closest = mouthDistance3(launch.origin);
    this.path = [copy(launch.origin)];
  }

  /** Feed one step prev → next with the non-ground contacts of that step. `caught` = the keeper holds the ball. */
  step(prev: BallState, next: BallState, contacts: readonly ContactEvent[], caught: boolean): JudgeStep {
    this.stepCount++;
    if (this.stepCount % PATH_EVERY === 0) this.path.push(copy(next.p));
    let lineCross: LineCross | null = null;
    for (const c of contacts) {
      if (c.tag === 'ground' || c.tag === 'net') continue;
      if (this.firstBlockT === null) this.firstBlockT = c.t;
      if (c.tag === 'post' || c.tag === 'bar') this.frameTag = this.frameTag ?? c.tag;
      else if (c.tag === 'keeperHand' || c.tag === 'keeperBody') {
        this.keeperTouched = true;
        this.keeperT = this.keeperT ?? c.t;
      } else if (c.tag === 'wall' || c.tag === 'defender') {
        this.wallTouched = true;
        this.wallT = this.wallT ?? c.t;
      }
    }
    if (this.freeFlight && this.firstBlockT === null && !this.crossing) {
      this.apex = Math.max(this.apex, next.p.y);
      this.lateral = Math.max(this.lateral, lateralOffset(this.launch, next.p));
    }
    if (this.firstBlockT !== null) this.freeFlight = false;
    this.closest = Math.min(this.closest, mouthDistance3(next.p));

    if (!this.crossing && prev.p.z >= 0 && next.p.z < 0) {
      const u = prev.p.z / (prev.p.z - next.p.z);
      const x = prev.p.x + (next.p.x - prev.p.x) * u;
      const y = prev.p.y + (next.p.y - prev.p.y) * u;
      const inside = Math.abs(x) < GOAL_HALF_WIDTH && y < GOAL_HEIGHT;
      this.crossing = { t: prev.t + (next.t - prev.t) * u, x, y, inside };
      lineCross = this.crossing;
    }
    if (this.decision) return { lineCross, decision: null };

    const t = next.t;
    let result: ShotResult | null = null;
    if (next.p.z < -BALL_R && prev.p.z >= -BALL_R) {
      const inMouth = Math.abs(next.p.x) < GOAL_HALF_WIDTH && next.p.y < GOAL_HEIGHT;
      result = inMouth ? 'goal' : this.fallback();
    } else if (caught) {
      result = 'caught';
    } else if (next.p.z < -BALL_R) {
      result = this.fallback();
    } else {
      const stopped = next.p.y < BALL_R + 0.02 && len(next.v) < STOP_SPEED;
      const gone = Math.abs(next.p.x) > 40 || next.p.z > this.launch.origin.z + 15;
      // Blocked (wall, keeper, defender, frame) and heading back into the field for a while: the chance is over.
      this.awayFor = this.firstBlockT !== null && next.v.z > 0.5 ? this.awayFor + (next.t - prev.t) : 0;
      const cleared = this.awayFor >= AWAY_DECIDE_S;
      if (stopped || gone || cleared || t >= SHOT_TIMEOUT) result = this.fallback();
    }
    if (result) this.decision = { result, t };
    return { lineCross, decision: this.decision };
  }

  private fallback(): ShotResult {
    if (this.keeperTouched) return 'saved';
    if (this.frameTag) return this.frameTag;
    if (this.wallTouched) return 'wall';
    return 'miss';
  }

  summary(speed: number, spinRps: number): ShotSummary {
    const d = this.decision ?? { result: 'miss' as ShotResult, t: SHOT_TIMEOUT };
    const crossing = this.crossing ? { x: this.crossing.x, y: this.crossing.y } : null;
    let miss = 0;
    const blocked = this.firstBlockT !== null && (!this.crossing || this.firstBlockT <= this.crossing.t);
    if (d.result !== 'goal') {
      if (blocked && this.predicted) miss = mouthDistance(this.predicted.x, this.predicted.y);
      else if (crossing) miss = mouthDistance(crossing.x, crossing.y);
      else miss = this.closest;
    }
    let timeToGoalS: number;
    if ((d.result === 'saved' || d.result === 'caught') && this.keeperT !== null) timeToGoalS = this.keeperT;
    else if (d.result === 'wall' && this.wallT !== null) timeToGoalS = this.wallT;
    else timeToGoalS = this.crossing ? this.crossing.t : (this.firstBlockT ?? d.t);
    return {
      mode: this.mode,
      spotKey: this.spotKey,
      result: d.result,
      speedKmh: speed * 3.6,
      spinRps,
      lateralCurveM: this.lateral,
      apexM: this.apex,
      timeToGoalS,
      crossing,
      missDistanceM: miss,
      path: this.path.slice(),
    };
  }
}

/** Horizontal perpendicular distance of p from the straight launch line. */
export function lateralOffset(l: LaunchParams, p: Vec3): number {
  const dx = Math.sin(l.azimuth);
  const dz = -Math.cos(l.azimuth);
  const rx = p.x - l.origin.x;
  const rz = p.z - l.origin.z;
  return Math.abs(rx * dz - rz * dx);
}
