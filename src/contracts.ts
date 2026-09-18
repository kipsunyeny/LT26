/**
 * LT26 module contract. Owned by the orchestrator.
 * Every module codes against these types. Change only via docs/ARCHITECTURE.md first.
 *
 * WORLD FRAME (metres, seconds, radians, SI units everywhere unless a name says otherwise):
 *   - y is up, ground plane is y = 0.
 *   - The goal line is the plane z = 0; the goal mouth is centred on x = 0.
 *   - The pitch (where the kicker stands) is z > 0. The goal net is behind the line at z < 0.
 *   - A kicker at (0, 0, 25) facing the goal looks along -z; +x is to the kicker's RIGHT.
 *   - Posts: inner faces at x = ±3.66, crossbar underside at y = 2.44, post/bar radius 0.06
 *     (centre lines at x = ±(3.66 + 0.06), y = 2.44 + 0.06).
 */

// ---------------------------------------------------------------------------
// Basic math
// ---------------------------------------------------------------------------
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

// ---------------------------------------------------------------------------
// Physics (src/physics) — pure, deterministic, no Three.js, no DOM.
// ---------------------------------------------------------------------------

/** Full dynamic state of the ball. w = angular velocity (spin vector) in rad/s, world frame. */
export interface BallState {
  t: number;
  p: Vec3;
  v: Vec3;
  w: Vec3;
}

export interface PhysicsEnv {
  /** Air density kg/m³. 1.20 sea level, 0.99 Nairobi (~1,800 m). 0 = vacuum (tests). */
  rho: number;
  /** Seed for the knuckle-noise generator. Same seed + same inputs => identical trajectory. */
  seed: number;
  /** Gravity m/s² (default 9.81). */
  g?: number;
}

/**
 * Launch description, the single input to a kick trajectory.
 * azimuth: 0 = straight along -z (towards the goal from the pitch); positive = towards +x (kicker's right).
 * elevation: angle above horizontal.
 * sideSpin (rev/s): positive = ball CURVES TO +x (kicker's right) in flight. Negative curves left.
 * topSpin  (rev/s): positive = top spin (dips, Magnus force down); negative = back spin (floats).
 * Spin axes are built from the launch direction: sideSpin about world -y, topSpin about the
 * horizontal axis perpendicular to the launch azimuth (see physics/ball.ts spinVector()).
 */
export interface LaunchParams {
  origin: Vec3;
  speed: number;
  azimuth: number;
  elevation: number;
  sideSpin: number;
  topSpin: number;
}

/** A static or moving collider the ball can hit. Positions are sampled per physics step. */
export type Collider =
  | { kind: 'capsule'; tag: ColliderTag; a: Vec3; b: Vec3; radius: number; restitution: number; velocity?: Vec3 }
  | { kind: 'sphere'; tag: ColliderTag; center: Vec3; radius: number; restitution: number; velocity?: Vec3 }
  /** Axis-aligned box that absorbs the ball (the net volume). */
  | { kind: 'absorbBox'; tag: ColliderTag; min: Vec3; max: Vec3 };

export type ColliderTag = 'post' | 'bar' | 'net' | 'wall' | 'keeperHand' | 'keeperBody' | 'defender';

export interface ContactEvent {
  t: number;
  tag: ColliderTag | 'ground';
  /** Contact point on the ball surface. */
  point: Vec3;
  /** Ball speed immediately before the contact, m/s. */
  speedBefore: number;
  /** Index into the collider list given for that step (-1 for ground). */
  colliderIndex: number;
}

/** Provides the colliders present at time t (the sim moves the wall/keeper; physics just asks). */
export type ColliderProvider = (t: number) => readonly Collider[];

export interface SimulateOptions {
  /** Max simulated time in s (default 6). */
  maxTime?: number;
  /** Fixed step, default 1/240 s. Tests and game MUST use the default. */
  dt?: number;
  colliders?: ColliderProvider;
  /** Stop when the ball crosses the plane z = 0 (default false). */
  stopAtGoalLine?: boolean;
  /** Stop when the ball is at rest (default true). */
  stopAtRest?: boolean;
  /** Record every Nth step into the returned samples (default 1 = every 1/240 s). */
  sampleEvery?: number;
}

export interface Trajectory {
  samples: BallState[];
  contacts: ContactEvent[];
  /** First crossing of z = 0 (interpolated), or null. */
  lineCrossing: { t: number; p: Vec3; v: Vec3 } | null;
}

// ---------------------------------------------------------------------------
// Game modes, intents and events (src/sim, src/input, src/ui)
// ---------------------------------------------------------------------------
export type Mode = 'freeKick' | 'penalty' | 'longShot';

export type Phase =
  | 'setup' // placing the ball / choosing a spot
  | 'aiming' // player is composing the kick
  | 'runUp' // taker is running towards the ball (penalty, long shot)
  | 'pushed' // long shot: ball rolling after the first touch
  | 'flight' // ball struck, in play
  | 'result' // outcome decided, showing shot card
  | 'replay';

export type ControlScheme = 'swipe' | 'dial';

/**
 * What a control scheme produces. The sim resolves it into LaunchParams.
 * power: 0..1 (after scheme-specific easing). speedKmh = 40 + 75 * power (40..115 km/h).
 */
export interface KickIntent {
  kind: 'strike' | 'push';
  scheme: ControlScheme;
  /** 'angles' = direct launch angles (swipe). 'target' = point on the goal plane z = 0 (dial reticle). */
  aim: { kind: 'angles'; azimuth: number; elevation: number } | { kind: 'target'; x: number; y: number };
  power: number;
  /** rev/s, same sign convention as LaunchParams.sideSpin, clamped −10..+10. */
  sideSpin: number;
  /** rev/s, same sign convention as LaunchParams.topSpin, clamped −6..+6. */
  topSpin: number;
  /** Penalty only: open body shape but strike across (fools the keeper's read). */
  disguise?: boolean;
  /** performance.now()-style timestamp (ms) at which the strike happened (release). */
  atMs: number;
}

export type ShotResult = 'goal' | 'saved' | 'caught' | 'post' | 'bar' | 'wall' | 'miss';

export type SimEvent =
  | { type: 'phase'; phase: Phase; t: number }
  | { type: 'runUpStart'; t: number; contactAt: number }
  | { type: 'push'; t: number; launch: LaunchParams }
  | { type: 'kick'; t: number; launch: LaunchParams; timingErrorMs: number; scatterDeg: number }
  | { type: 'wallJump'; t: number }
  | { type: 'keeperDive'; t: number; side: -1 | 0 | 1; target: Vec3 }
  | { type: 'contact'; t: number; contact: ContactEvent }
  | { type: 'save'; t: number; caught: boolean }
  | { type: 'lineCross'; t: number; x: number; y: number; inside: boolean }
  | { type: 'result'; t: number; summary: ShotSummary };

export interface ShotSummary {
  mode: Mode;
  spotKey: string;
  result: ShotResult;
  speedKmh: number;
  /** |ω| at launch in rev/s. */
  spinRps: number;
  /** Max perpendicular distance of the path from the straight launch line (horizontal), m. */
  lateralCurveM: number;
  apexM: number;
  /** Time from strike to crossing z = 0 (or to the stopping contact), s. */
  timeToGoalS: number;
  /** Where the ball crossed z = 0, or null if it never did. */
  crossing: { x: number; y: number } | null;
  /** 0 for goals; otherwise distance from the crossing point (or closest approach) to the goal frame, m. */
  missDistanceM: number;
  /** Down-sampled ball path (≈60 Hz) for trails and ghosts. */
  path: Vec3[];
}

// ---------------------------------------------------------------------------
// World snapshot — what render draws. Produced from live sim state and stored in recordings.
// ---------------------------------------------------------------------------
export interface KeeperPose {
  /** Root position on the ground (feet), m. */
  p: Vec3;
  /** Lean/dive angle about z in rad: 0 standing, +π/2 fully laid out towards +x. */
  lean: number;
  /** Vertical offset of the body (jump), m. */
  lift: number;
  /** Hand centres, world frame. */
  hands: [Vec3, Vec3];
}

export interface WorldSnapshot {
  t: number;
  ball: { p: Vec3; w: Vec3 };
  keeper: KeeperPose;
  /** Wall defenders: feet positions + current jump height. Empty when no wall. */
  wall: { p: Vec3; jump: number }[];
  /** Long-shot closing defender, if any. */
  defender: { p: Vec3 } | null;
  /** Talilei: feet position, and 0..1 run-up progress (1 = at the ball). */
  taker: { p: Vec3; stride: number };
}

/** The replay is a recording of physics/sim states — never a re-simulation. */
export interface Recording {
  mode: Mode;
  spotKey: string;
  /** Sampled at 60 Hz from the live sim. */
  frames: WorldSnapshot[];
  events: SimEvent[];
  summary: ShotSummary;
}

export interface Settings {
  controlScheme: ControlScheme;
  altitude: 'nairobi' | 'sea';
  sound: boolean;
  footed: 'right' | 'left';
}

export interface SpotPreset {
  key: string;
  label: string;
  /** Ball position on the ground (y = 0.11). */
  ball: Vec3;
}

export interface GameState {
  mode: Mode;
  phase: Phase;
  spotKey: string;
  ballStart: Vec3;
  settings: Settings;
  /** Current world for rendering. */
  world: WorldSnapshot;
  /** Live ball state (flight). */
  ball: BallState;
  /** Last completed shot. */
  lastShot: ShotSummary | null;
  lastRecording: Recording | null;
  /** Session time in seconds (advanced by Sim.update). */
  time: number;
}

/** Sim public API — src/sim/index.ts exports createSim(opts): Sim. */
export interface Sim {
  readonly state: GameState;
  setMode(mode: Mode): void;
  /** Preset key or free placement (free kick only; clamped to 16–35 m from goal). */
  setSpot(spot: string | { x: number; z: number }): void;
  setSettings(s: Partial<Settings>): void;
  /** Penalty / long shot: start the run-up. Returns the sim time at which contact is ideal. */
  startRunUp(): number;
  /** Apply a push (long shot first touch) or strike. Ignored if the phase does not allow it. */
  applyIntent(intent: KickIntent): void;
  /** Advance by dt seconds (render frame time; internally fixed 240 Hz steps). */
  update(dt: number): void;
  /** Back to 'aiming' at the same spot. */
  resetShot(): void;
  on(listener: (e: SimEvent) => void): () => void;
  /** Aim-assist: launch that reaches target (x,y on z = 0) with given speed and spins, or null. */
  solveAim(target: { x: number; y: number }, speedKmh: number, sideSpin: number, topSpin: number): LaunchParams | null;
  /** Preview path for an intent without applying it (used for the ghost arrow/aim line). */
  previewPath(intent: KickIntent): Vec3[];
}

// ---------------------------------------------------------------------------
// Rendering (src/render) — src/render/index.ts exports createScene(canvas, opts): SceneApi
// ---------------------------------------------------------------------------
export type CameraMode = 'kick' | 'replay' | 'title';

export interface SceneStats {
  drawCalls: number;
  triangles: number;
  frameMs: number;
}

export interface SceneApi {
  setMode(mode: Mode): void;
  setCamera(mode: CameraMode): void;
  /** Draw one frame of the given world. For replay pass recorded frames. */
  render(world: WorldSnapshot, dt: number): void;
  /** Flight path (live/replay) and optional ghost (best kick). Pass null to clear. */
  setTrail(points: Vec3[] | null, ghost?: Vec3[] | null): void;
  /** Aim preview line (dial/swipe ghost arrow in world space). */
  setAimPreview(points: Vec3[] | null): void;
  worldToScreen(p: Vec3): { x: number; y: number; visible: boolean };
  /** Screen pixel -> point on the goal plane z = 0 (x, y in metres). */
  screenToGoalPlane(sx: number, sy: number): { x: number; y: number } | null;
  /** Screen radius (px) of the ball at its current position. */
  ballScreenRadius(): number;
  resize(width: number, height: number, pixelRatio: number): void;
  getStats(): SceneStats;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Input (src/input) — both schemes implement InputScheme.
// ---------------------------------------------------------------------------
export interface InputContext {
  mode(): Mode;
  phase(): Phase;
  settings(): Settings;
  /** Ball centre and radius in CSS pixels. */
  ballScreen(): { x: number; y: number; r: number };
  screenToGoalPlane(sx: number, sy: number): { x: number; y: number } | null;
  worldToScreen(p: Vec3): { x: number; y: number; visible: boolean };
  now(): number;
  emitIntent(intent: KickIntent): void;
  /** Penalty/long-shot: begin the run-up (hold). */
  startRunUp(): void;
  /** Visual feedback (ghost arrow / reticle / power). null clears. */
  preview(p: InputPreview | null): void;
}

export interface InputPreview {
  /** Screen-space polyline of the swipe (swipe scheme). */
  swipePath?: { x: number; y: number }[];
  intent?: KickIntent;
}

export interface InputScheme {
  readonly id: ControlScheme;
  attach(el: HTMLElement, ctx: InputContext): void;
  detach(): void;
}

/** A pointer sample for pure gesture math (touch or mouse, CSS px, ms). */
export interface PointerSample {
  x: number;
  y: number;
  t: number;
}

// ---------------------------------------------------------------------------
// Data (src/data)
// ---------------------------------------------------------------------------
export interface SpotStats {
  spotKey: string;
  mode: Mode;
  attempts: number;
  goals: number;
  /** Mean miss distance over non-goals, m. */
  avgMissM: number;
  /** Best kick (a goal with the smallest distance to a corner, else smallest miss) — path for the ghost. */
  best: ShotSummary | null;
}

export interface SessionLog {
  record(s: ShotSummary): SpotStats;
  get(spotKey: string): SpotStats | null;
  all(): SpotStats[];
  reset(): void;
}

/** Debug/test hook exposed on window.__lt26 by main.ts (always present; harmless in production). */
export interface DebugHook {
  sim: Sim;
  scene: SceneApi | null;
  intents: KickIntent[];
  events: SimEvent[];
  screen(): string;
}
