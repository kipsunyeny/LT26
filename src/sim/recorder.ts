// Replay recording: 60 Hz WorldSnapshots of the live sim from the strike to the result + 0.5 s. Never re-simulates.
import type { Mode, Recording, ShotSummary, SimEvent, Vec3, WorldSnapshot } from '../contracts';

export const RECORD_EVERY_STEPS = 4; // 240 Hz / 4 = 60 Hz
export const RECORD_TAIL_S = 0.5;

const cv = (p: Vec3): Vec3 => ({ x: p.x, y: p.y, z: p.z });

export function cloneWorld(w: WorldSnapshot): WorldSnapshot {
  return {
    t: w.t,
    ball: { p: cv(w.ball.p), w: cv(w.ball.w) },
    keeper: {
      p: cv(w.keeper.p),
      lean: w.keeper.lean,
      lift: w.keeper.lift,
      hands: [cv(w.keeper.hands[0]), cv(w.keeper.hands[1])],
    },
    wall: w.wall.map((d) => ({ p: cv(d.p), jump: d.jump })),
    defender: w.defender ? { p: cv(w.defender.p) } : null,
    taker: { p: cv(w.taker.p), stride: w.taker.stride },
  };
}

export class Recorder {
  readonly frames: WorldSnapshot[] = [];
  readonly events: SimEvent[] = [];
  private steps = 0;
  private tailLeft: number | null = null;
  recording: Recording | null = null;

  constructor(
    readonly mode: Mode,
    readonly spotKey: string,
  ) {}

  /** Call once at the strike with the world at that instant. */
  start(world: WorldSnapshot): void {
    this.frames.push(cloneWorld(world));
  }

  event(e: SimEvent): void {
    if (!this.done) this.events.push(e);
  }

  /** Call after every physics step while recording. */
  step(world: WorldSnapshot, dt: number): void {
    if (this.done) return;
    this.steps++;
    if (this.steps % RECORD_EVERY_STEPS === 0) this.frames.push(cloneWorld(world));
    if (this.tailLeft !== null) this.tailLeft -= dt;
  }

  /** The result is known: returns the (still growing for 0.5 s) Recording. */
  finish(summary: ShotSummary): Recording {
    this.tailLeft = RECORD_TAIL_S;
    this.recording = { mode: this.mode, spotKey: this.spotKey, frames: this.frames, events: this.events, summary };
    return this.recording;
  }

  get done(): boolean {
    return this.tailLeft !== null && this.tailLeft <= 1e-9;
  }
}
