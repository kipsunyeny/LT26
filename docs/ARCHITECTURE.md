# LT26 Architecture

Status: **contract v1** (Phase 0). The TypeScript source of truth is [`src/contracts.ts`](../src/contracts.ts). This document explains it and fixes the module boundaries, file ownership and public entry points. Interfaces change only by editing this file and `src/contracts.ts` first (orchestrator), then dispatching the change to every affected owner.

## 1. Layers and dependency rules

```
            ┌──────────────── ui/ (screens, HUD, router, frame loop) ───────────────┐
            │                    ▲ writes intents          ▲ reads GameState       │
 input/ ────┘ (gestures → KickIntent)                      │                       │
                                   ▼                       │                       ▼
                               sim/ (modes, keeper, wall, rules, recording) ──► render/ (Three.js)
                                   │ calls                                   ▲ draws WorldSnapshot
                                   ▼                                         │
                              physics/ (pure ball model, collisions, solver) │
 data/ (settings, session log, presets) ◄── sim/ui                          audio/
```

| Module | May import | Must not import |
| --- | --- | --- |
| `physics/` | `contracts` only | three, DOM, sim, render, ui, input |
| `sim/` | `contracts`, `physics/`, `data/presets` | three, DOM (except none), render, ui, input |
| `render/` | `contracts`, three, `assets/` | sim internals (reads only `WorldSnapshot` / trails) |
| `input/` | `contracts` | three, sim internals, render internals |
| `ui/` | everything's public entry points | module internals |
| `data/` | `contracts` | three |

ESLint enforces the physics/sim import bans.

Rules from the brief: physics is deterministic given a seed; sim depends on physics only; render reads sim state; ui/input write intents into sim; one `GameState` drives everything; **the replay is a recording of states (`Recording.frames`), never a re-simulation**; every trajectory in the game comes from `physics.simulate`/`physics.stepBall` — the same functions the acceptance tests call.

## 2. World frame and conventions

- Metres, seconds, radians, kg. `y` up, ground `y = 0`.
- Goal line is the plane `z = 0`, goal centred on `x = 0`. The pitch is `z > 0`; the net is behind the line (`z < 0`, depth 2.0 m).
- A kicker facing goal looks along `-z`; `+x` is the kicker's **right**. (This matches a Three.js camera that looks down `-z`.)
- Goal: inner width 7.32 m (posts' inner faces at `x = ±3.66`), crossbar underside `y = 2.44`, posts/bar radius 0.06 m.
- Ball radius 0.11 m, resting centre `y = 0.11`.
- **azimuth** 0 = along `-z`; positive azimuth points towards `+x`.
- **sideSpin** (rev/s) positive ⇒ the ball **curves towards +x** (right). **topSpin** positive ⇒ top spin (dips); negative ⇒ back spin (floats). Physics converts these to a world spin vector with `spinVector(azimuth, sideSpin, topSpin)`: ω = 2π·(−sideSpin·ŷ − topSpin·r̂) with r̂ = `(cos az, 0, sin az)` the kicker's right-hand horizontal axis; horizontal launch direction is `(sin az, 0, −cos az)`. Check: ω × v then points to +x for sideSpin > 0 and down for topSpin > 0.
- Power: `KickIntent.power` ∈ [0,1]; ball speed `speedKmh = 40 + 75·power`.
- Scatter above 90 % power: Gaussian aim scatter σ = 1.5° at 90 % rising linearly to 3.5° at 100 %; below 90 % none. Applied by **sim** with its seeded RNG.
- Run-up timing: `timingErrorMs = intent.atMs − idealContactMs`. |err| ≤ 80 ms → full power, no timing scatter. Beyond that, power multiplier falls linearly to 0.75 and extra σ rises linearly to 3° at |err| = 400 ms (clamped beyond). Applied by **sim**.
- Left-footed setting mirrors the **labels** "inside/outside of the foot" in the UI (the physics sign stays: + curves right).

## 3. Public entry points (fixed names)

### physics/ (owner: physics engineer)
```ts
// src/physics/constants.ts
export const BALL_MASS = 0.43, BALL_RADIUS = 0.11, BALL_AREA, G = 9.81, RHO_SEA = 1.2, RHO_NAIROBI = 0.99,
             DT = 1 / 240, SPIN_DECAY_TAU = 10, GROUND_RESTITUTION = 0.6, GROUND_MU = 0.4,
             POST_RESTITUTION = 0.7, GOAL_HALF_WIDTH = 3.66, GOAL_HEIGHT = 2.44, POST_RADIUS = 0.06, NET_DEPTH = 2.0;
// src/physics/ball.ts
export function dragCoefficient(speed: number): number;
export function liftCoefficient(spinParameter: number): number;
export function spinVector(azimuth: number, sideSpinRps: number, topSpinRps: number): Vec3;
export function launchState(l: LaunchParams): BallState;
export function acceleration(s: BallState, env: PhysicsEnv, knuckle: Vec3): Vec3;
export function stepBall(s: BallState, dt: number, env: PhysicsEnv, noise: KnuckleNoise, colliders?: readonly Collider[]): { state: BallState; contacts: ContactEvent[] };
export function simulate(l: LaunchParams, env: PhysicsEnv, opts?: SimulateOptions): Trajectory;
// src/physics/collisions.ts
export function goalFrameColliders(): Collider[];      // posts, bar, net absorb box
export function collideGround(...), collideCollider(...);
// src/physics/rng.ts
export function mulberry32(seed: number): () => number;
export function gaussian(rng: () => number): number;
export interface KnuckleNoise { sample(t: number, speed: number, spin: number): Vec3 }
export function createKnuckleNoise(seed: number): KnuckleNoise;
// src/physics/solver.ts
export function solveLaunch(origin: Vec3, target: {x:number;y:number}, speed: number, sideSpin: number, topSpin: number, env: PhysicsEnv): LaunchParams | null;
// src/physics/index.ts re-exports all of the above.
```

### sim/ and data/ (owner: gameplay/sim engineer)
```ts
// src/sim/index.ts
export interface CreateSimOptions { settings: Settings; seed?: number }
export function createSim(opts: CreateSimOptions): Sim;      // Sim interface in contracts.ts
// src/sim/keeper.ts, wall.ts, rules.ts, freeKick.ts, penalty.ts, longShot.ts, recorder.ts — internal
// src/data/presets.ts
export const SPOTS: Record<Mode, SpotPreset[]>;              // keys stable, used by the session log
export function defaultSpot(mode: Mode): SpotPreset;
// src/data/sessionLog.ts
export function createSessionLog(storage: Storage | null): SessionLog;   // key 'lt26.log.v1'
```
Required spots: free kick `fk-centre` (centre of the D, 22 m), `fk-left-d`, `fk-right-d` (edges of the D), `fk-wide-left`, `fk-wide-right`; free placement produces key `fk-x{X}-z{Z}` rounded to the metre. Penalty `pk-spot` (11 m). Long shot `ls-centre`, `ls-left`, `ls-right` (20–30 m).

Sim timing: `Sim.update(dt)` accumulates and steps physics at exactly 240 Hz; `state.world` is the latest snapshot (interpolation is optional; the step is small). Recording frames are captured at 60 Hz from flight start to the result + 0.5 s. `state.time` is the sim clock in s; **intent timestamps (`atMs`) are sim-clock milliseconds** (`state.time*1000`) — the UI passes `sim.state.time*1000` via `InputContext.now()`.

### render/ and audio/ (owner: rendering engineer)
```ts
// src/render/index.ts
export interface CreateSceneOptions { antialias?: boolean }
export function createScene(canvas: HTMLCanvasElement, opts?: CreateSceneOptions): SceneApi;  // throws if no WebGL
// src/audio/index.ts
export type SoundName = 'kick' | 'post' | 'net' | 'crowd' | 'whistle' | 'save';
export interface AudioApi { play(name: SoundName, intensity?: number): void; setEnabled(on: boolean): void; unlock(): void }
export function createAudio(): AudioApi;
```
Colours in 3D: pitch greens, white lines, goal white, **wall red**, **keeper green**, ball white with **navy** panels, Talilei = camera-facing sprite from `assets/brand/talilei-*.webp`, placed beside the ball (left of the ball for a right-footer, mirrored for left) in every mode, never between ball and camera centre line.

### input/ and ui/ (owner: input & UI engineer)
```ts
// src/input/pointer.ts   unified touch/mouse → PointerSample streams
// src/input/swipe.ts     export function swipeToIntent(path: PointerSample[], ball: {x,y,r}, opts: SwipeOptions): KickIntent | null; export function createSwipeScheme(): InputScheme;
// src/input/dial.ts      export function createDialScheme(): InputScheme;
// src/input/runUp.ts     timing helpers shared by both schemes
// src/ui/app.ts
export interface AppDeps { sim: Sim; scene: SceneApi | null; log: SessionLog; audio: AudioApi; canvas: HTMLCanvasElement }
export interface App { screen(): string; destroy(): void }
export function createApp(root: HTMLElement, deps: AppDeps): App;   // owns screens + requestAnimationFrame loop
```
Screens: `title`, `play`, `replay`, `stats`, `settings`. `App.screen()` returns the current one. The app pushes every emitted intent into `window.__lt26.intents` (via the DebugHook created in `main.ts`).

DOM test ids (stable, used by E2E): `data-testid` = `btn-mode-freeKick`, `btn-mode-penalty`, `btn-mode-longShot`, `btn-stats`, `btn-settings`, `btn-back`, `btn-shoot`, `btn-next`, `btn-replay`, `hud`, `hud-logo`, `shot-card`, `power-bar`, `knob-curve`, `knob-dip`, `reticle`, `minimap`, `spot-<key>`, `talilei` (title only; in-game Talilei is 3D), `setting-scheme`, `setting-altitude`, `setting-sound`, `setting-footed`, `btn-reset-data`, `rotate-prompt`, `stats-table`.

### main.ts (owner: orchestrator)
Builds settings → sim → scene (null if WebGL unavailable) → audio → session log → `createApp`, exposes `window.__lt26: DebugHook`, registers `./sw.js` in production.

### public/, docs, workflows (owner: docs & release engineer)
`public/manifest.webmanifest`, `public/icons/*` (generated by `npm run assets`), `public/sw.js` (precache of the whole build, generated inside `vite build` by the plugin `scripts/sw-plugin.ts` from the emitted files so hashed filenames are included), `.github/workflows/pages.yml`, README, CHANGELOG, TESTING.

## 4. Data flow of one kick

1. UI shows `play` screen; the active `InputScheme` is attached to the canvas overlay with an `InputContext`.
2. (Penalty/long shot) the scheme calls `ctx.startRunUp()` → UI → `sim.startRunUp()` → sim emits `runUpStart {contactAt}`.
3. Scheme emits a `KickIntent` → UI records it in `__lt26.intents` → `sim.applyIntent`.
4. Sim resolves the intent → applies power/timing/scatter → `LaunchParams` → emits `kick`; wall jumps 0.15 s later (`wallJump`); keeper reacts after its reaction time (`keeperDive`).
5. Sim steps `physics.stepBall` at 240 Hz with the provider of current colliders (goal frame + wall capsules + keeper spheres/capsule), emits `contact`, `save`, `lineCross`, and finally `result` with a `ShotSummary`; builds `Recording` (60 Hz `WorldSnapshot`s).
6. UI records the summary in the `SessionLog`, shows the shot card, offers replay: plays `Recording.frames` through `scene.render` with `setCamera('replay')` at 0.35× speed, trail = `summary.path`, ghost = `log.get(spot).best.path`.

## 5. Performance budget
≤ 60 k triangles in view, ≤ 20 draw calls for the static scene (≤ 40 total gate in E2E), textures ≤ 2048², total download ≤ 6 MB. `SceneApi.getStats()` returns `renderer.info.render` numbers for the perf test.
