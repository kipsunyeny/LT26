// LT26 sim: mode state machines, keeper, wall, rules and recording on top of the physics module.
import type {
  BallState,
  Collider,
  ContactEvent,
  GameState,
  KickIntent,
  LaunchParams,
  Mode,
  Phase,
  PhysicsEnv,
  Settings,
  Sim,
  SimEvent,
  SpotPreset,
  Vec3,
  WorldSnapshot,
} from '../contracts';
import {
  DT,
  RHO_NAIROBI,
  RHO_SEA,
  createKnuckleNoise,
  gaussian,
  goalFrameColliders,
  launchState,
  mulberry32,
  simulate,
  solveLaunch,
  stepBall,
  type KnuckleNoise,
} from '../physics';
import { defaultSpot, findSpot, freeKickSpot } from '../data/presets';
import { FK_SCREEN_DELAY, freeKickSetup } from './freeKick';
import { applyScatter, powerScatterDeg, resolveLaunch, timingPenalty } from './kick';
import { KEEPER, Keeper, keeperGuess, reactionTime, type Prediction } from './keeper';
import {
  chaseStep,
  defenderCollider,
  defenderStart,
  defenderStep,
  longShotKeeper,
  pushSpeed,
  type Chase,
  type Mover,
} from './longShot';
import { PK_KEEPER, RUN_UP_TIME, aimSide, runUpPosition } from './penalty';
import { Recorder } from './recorder';
import { BALL_R, ShotJudge } from './rules';
import { takerStand } from './taker';
import { WALL_JUMP_DELAY, wallColliders, wallJumpHeight, wallJumpSpeed, type WallLayout } from './wall';
import { copy, len, v3 } from './vec';

export interface CreateSimOptions {
  settings: Settings;
  seed?: number;
}

const MAX_FRAME_DT = 0.1;
const ZERO_NOISE: KnuckleNoise = { sample: () => ({ x: 0, y: 0, z: 0 }) };
/** Ground contacts are reported only for real bounces (vertical approach faster than this), m/s. */
const BOUNCE_EVENT_VY = 1;
/** Same-tag contact events closer together than this are merged, s. */
const CONTACT_EVENT_GAP = 0.15;
const PREDICT_HORIZON = 3;

/** A push rolls without slipping: top spin v/(2πr) rev/s (a spinless push would skid first). */
function pushLaunch(origin: Vec3, azimuth: number, power: number): LaunchParams {
  const speed = pushSpeed(power);
  return { origin: copy(origin), speed, azimuth, elevation: 0, sideSpin: 0, topSpin: speed / (2 * Math.PI * BALL_R) };
}

export const rhoFor = (s: Settings): number => (s.altitude === 'sea' ? RHO_SEA : RHO_NAIROBI);

interface Shot {
  launch: LaunchParams;
  noise: KnuckleNoise;
  env: PhysicsEnv;
  judge: ShotJudge;
  recorder: Recorder;
  wallJumped: boolean;
  caught: boolean;
  decided: boolean;
  lastContact: Map<string, number>;
}

interface Push {
  t: number;
  contactAt: number;
  chase: Chase;
  reached: boolean;
}

export function createSim(opts: CreateSimOptions): Sim {
  const rng = mulberry32((opts.seed ?? 1) >>> 0);
  const listeners = new Set<(e: SimEvent) => void>();
  const frame = goalFrameColliders();
  const keeper = new Keeper(0, PK_KEEPER.z);
  let spot: SpotPreset = defaultSpot('freeKick');
  let wall: WallLayout | null = null;
  let defender: Mover | null = null;
  let acc = 0;
  let shot: Shot | null = null;
  let runUp: { t0: number; contactAt: number } | null = null;
  let push: Push | null = null;
  let takerPos: Vec3 = v3(0, 0, 0);
  let takerStride = 0;
  let strikeTime = 0;
  const drawSeed = (): number => Math.floor(rng() * 0x7fffffff);
  let nextNoiseSeed = drawSeed();

  const settings: Settings = { ...opts.settings };
  const restBall = (p: Vec3): BallState => ({ t: 0, p: copy(p), v: v3(0, 0, 0), w: v3(0, 0, 0) });

  const state: GameState = {
    mode: 'freeKick',
    phase: 'aiming',
    spotKey: spot.key,
    ballStart: copy(spot.ball),
    settings,
    world: undefined as unknown as WorldSnapshot,
    ball: restBall(spot.ball),
    lastShot: null,
    lastRecording: null,
    time: 0,
  };

  const env = (): PhysicsEnv => ({ rho: rhoFor(settings), seed: nextNoiseSeed });

  function emit(e: SimEvent): void {
    if (shot && !shot.recorder.done) shot.recorder.event(e);
    for (const l of listeners) l(e);
  }

  function setPhase(p: Phase): void {
    if (state.phase === p) return;
    state.phase = p;
    emit({ type: 'phase', phase: p, t: state.time });
  }

  function flightTime(): number | null {
    return shot ? state.time - strikeTime : null;
  }

  function buildWorld(): WorldSnapshot {
    const ft = state.mode === 'freeKick' ? flightTime() : null;
    const jump = wallJumpHeight(ft);
    return {
      t: state.time,
      ball: { p: copy(state.ball.p), w: copy(state.ball.w) },
      keeper: keeper.pose(),
      wall: wall ? wall.feet.map((p) => ({ p: copy(p), jump })) : [],
      defender: defender ? { p: copy(defender.p) } : null,
      taker: { p: copy(takerPos), stride: takerStride },
    };
  }

  function placeKeeper(): void {
    const b = spot.ball;
    if (state.mode === 'penalty') keeper.setPosition(PK_KEEPER.xs, PK_KEEPER.z);
    else if (state.mode === 'freeKick') {
      const k = freeKickSetup(b).keeper;
      keeper.setPosition(k.xs, k.z);
    } else {
      const k = longShotKeeper(b);
      keeper.setPosition(k.xs, k.z);
    }
  }

  function setup(): void {
    shot = null;
    runUp = null;
    push = null;
    acc = 0;
    state.spotKey = spot.key;
    state.ballStart = copy(spot.ball);
    state.ball = restBall(spot.ball);
    wall = state.mode === 'freeKick' ? freeKickSetup(spot.ball).wall : null;
    defender = state.mode === 'longShot' ? { p: defenderStart(spot.ball), v: v3(0, 0, 0) } : null;
    placeKeeper();
    takerPos = takerStand(spot.ball, settings);
    takerStride = 0;
    state.world = buildWorld();
    setPhase('aiming');
  }

  // ------------------------------------------------------------------ colliders & prediction
  function liveColliders(): Collider[] {
    const ft = flightTime();
    const cols: Collider[] = frame.slice();
    if (wall) cols.push(...wallColliders(wall, wallJumpHeight(ft), wallJumpSpeed(ft)));
    if (shot && !shot.caught) cols.push(...keeper.colliders());
    if (defender) cols.push(defenderCollider(defender));
    return cols;
  }

  /** Keeper's read of the flight: steps the physics (no noise, no colliders) from the current ball state. */
  function predict(): Prediction {
    let s = state.ball;
    const out: Prediction = { plane: null, line: null };
    if (s.v.z >= 0) return out;
    const e = shot ? shot.env : env();
    const kz = keeper.z;
    const t0 = s.t;
    while (s.t - t0 < PREDICT_HORIZON) {
      const n = stepBall(s, DT, e, ZERO_NOISE).state;
      if (!out.plane && s.p.z >= kz && n.p.z < kz) {
        const u = (s.p.z - kz) / (s.p.z - n.p.z);
        out.plane = { x: s.p.x + (n.p.x - s.p.x) * u, y: s.p.y + (n.p.y - s.p.y) * u };
      }
      if (s.p.z >= 0 && n.p.z < 0) {
        const u = s.p.z / (s.p.z - n.p.z);
        out.line = { x: s.p.x + (n.p.x - s.p.x) * u, y: s.p.y + (n.p.y - s.p.y) * u };
        break;
      }
      if (n.v.z >= 0 || len(n.v) < 0.2) break;
      s = n;
    }
    if (!out.plane && state.ball.p.z < kz + 0.4 && state.ball.p.z > 0) {
      out.plane = { x: state.ball.p.x, y: state.ball.p.y };
    }
    return out;
  }

  // ------------------------------------------------------------------ intents
  function resolve(intent: KickIntent, origin: Vec3, ballVel: Vec3, mult: number): LaunchParams {
    return resolveLaunch(intent, origin, ballVel, mult, env());
  }

  function doStrike(intent: KickIntent): void {
    let timingErrorMs = 0;
    if (state.phase === 'runUp' && runUp) timingErrorMs = intent.atMs - runUp.contactAt * 1000;
    else if (state.phase === 'pushed' && push) timingErrorMs = intent.atMs - push.contactAt * 1000;
    if (!Number.isFinite(timingErrorMs)) timingErrorMs = 0;
    const pen = timingPenalty(timingErrorMs);
    const pSig = powerScatterDeg(intent.power);
    const sigma = Math.hypot(pSig, pen.sigmaDeg);
    const g1 = gaussian(rng);
    const g2 = gaussian(rng);
    const uReaction = rng();
    const uGuess = rng();
    const origin = copy(state.ball.p);
    const ballVel = state.phase === 'pushed' ? copy(state.ball.v) : v3(0, 0, 0);
    const base = resolve(intent, origin, ballVel, pen.powerMult);
    const launch = applyScatter(base, sigma, g1, g2);
    const e = env();

    // Keeper plan: reaction window, penalty read of the run-up.
    let guessSide: -1 | 0 | 1 = 0;
    let reaction = reactionTime(uReaction);
    if (state.mode === 'penalty') {
      const tr = simulate(base, e, { stopAtGoalLine: true, maxTime: 2 });
      guessSide = keeperGuess(aimSide(tr.lineCrossing ? tr.lineCrossing.p.x : null), !!intent.disguise, uGuess);
    } else if (state.mode === 'freeKick' && wall) {
      reaction += FK_SCREEN_DELAY;
    }

    strikeTime = state.time;
    state.ball = launchState(launch);
    takerStride = 1;
    if (state.phase === 'runUp') takerPos = runUpPosition(spot.ball, settings, 1);
    if (defender) defender = { p: defender.p, v: v3(0, 0, 0) };
    keeper.strike({ reaction, guessSide });
    const recorder = new Recorder(state.mode, spot.key);
    shot = {
      launch,
      noise: createKnuckleNoise(e.seed),
      env: e,
      judge: new ShotJudge(state.mode, spot.key, launch),
      recorder,
      wallJumped: false,
      caught: false,
      decided: false,
      lastContact: new Map(),
    };
    runUp = null;
    push = null;
    state.world = buildWorld();
    recorder.start(state.world);
    setPhase('flight');
    emit({ type: 'kick', t: state.time, launch, timingErrorMs, scatterDeg: sigma });
  }

  function doPush(intent: KickIntent): void {
    const b = state.ball.p;
    const azimuth =
      intent.aim.kind === 'angles' ? intent.aim.azimuth : Math.atan2(intent.aim.x - b.x, Math.max(b.z, 0.1));
    const launch = pushLaunch(b, azimuth, intent.power);
    state.ball = launchState(launch);
    const p: Push = {
      t: state.time,
      contactAt: state.time,
      chase: { m: { p: copy(takerPos), v: v3(0, 0, 0) }, separated: false },
      reached: false,
    };
    // Ideal contact: run the same deterministic roll + chase forward until the taker reaches the ball.
    let s = state.ball;
    let ch = p.chase;
    const e = env();
    let t = 0;
    for (; t < 4; t += DT) {
      s = stepBall(s, DT, e, ZERO_NOISE, frame).state;
      const c = chaseStep(ch, takerStand(s.p, settings), s.v, DT);
      ch = c.c;
      if (c.reached) break;
    }
    p.contactAt = state.time + t + DT;
    push = p;
    setPhase('pushed');
    emit({ type: 'push', t: state.time, launch });
    emit({ type: 'runUpStart', t: state.time, contactAt: p.contactAt });
  }

  // ------------------------------------------------------------------ stepping
  function stepShot(): void {
    const s = shot as Shot;
    const ft = state.time - strikeTime;
    if (wall && !s.wallJumped && ft >= WALL_JUMP_DELAY - 1e-9) {
      s.wallJumped = true;
      emit({ type: 'wallJump', t: state.time });
    }
    const k = keeper.step(DT, predict);
    if (k.dive) emit({ type: 'keeperDive', t: state.time, side: k.dive.side, target: k.dive.target });
    const prev = state.ball;
    let next: BallState;
    let contacts: ContactEvent[] = [];
    if (s.caught) {
      const [h1, h2] = keeper.hands();
      next = {
        t: prev.t + DT,
        p: v3((h1.x + h2.x) / 2, (h1.y + h2.y) / 2, (h1.z + h2.z) / 2),
        v: v3(0, 0, 0),
        w: v3(0, 0, 0),
      };
    } else {
      const r = stepBall(prev, DT, s.env, s.noise, liveColliders());
      next = r.state;
      contacts = r.contacts;
    }
    const solid: ContactEvent[] = [];
    for (const c of contacts) {
      if (c.tag !== 'ground') solid.push(c);
      if (c.tag === 'keeperHand' || c.tag === 'keeperBody') {
        if (!s.caught && c.speedBefore < KEEPER.catchSpeed && !s.decided) {
          s.caught = true;
          keeper.freeze();
          const [h1, h2] = keeper.hands();
          next = {
            t: next.t,
            p: v3((h1.x + h2.x) / 2, (h1.y + h2.y) / 2, (h1.z + h2.z) / 2),
            v: v3(0, 0, 0),
            w: v3(0, 0, 0),
          };
          emit({ type: 'save', t: state.time, caught: true });
        } else if (!s.lastContact.has('save')) {
          emit({ type: 'save', t: state.time, caught: false });
        }
        s.lastContact.set('save', state.time);
      }
      const reportable = c.tag !== 'ground' || prev.v.y < -BOUNCE_EVENT_VY;
      const last = s.lastContact.get(c.tag);
      if (reportable && (last === undefined || state.time - last >= CONTACT_EVENT_GAP)) {
        s.lastContact.set(c.tag, state.time);
        emit({ type: 'contact', t: state.time, contact: { ...c, t: state.time } });
      }
    }
    state.ball = next;
    if (!s.decided) {
      const j = s.judge.step(prev, next, solid, s.caught);
      if (j.lineCross)
        emit({ type: 'lineCross', t: state.time, x: j.lineCross.x, y: j.lineCross.y, inside: j.lineCross.inside });
      if (j.decision) {
        s.decided = true;
        const summary = s.judge.summary(s.launch.speed, len(launchState(s.launch).w) / (2 * Math.PI));
        state.lastShot = summary;
        state.world = buildWorld();
        s.recorder.step(state.world, DT);
        state.lastRecording = s.recorder.finish(summary);
        setPhase('result');
        emit({ type: 'result', t: state.time, summary });
        return;
      }
    }
    state.world = buildWorld();
    s.recorder.step(state.world, DT);
  }

  function stepPushed(): void {
    const p = push as Push;
    const r = stepBall(state.ball, DT, env(), ZERO_NOISE, liveColliders());
    state.ball = r.state;
    if (!p.reached) {
      const c = chaseStep(p.chase, takerStand(state.ball.p, settings), state.ball.v, DT);
      p.chase = c.c;
      p.reached = c.reached;
    } else {
      p.chase = { m: { p: takerStand(state.ball.p, settings), v: copy(state.ball.v) }, separated: true };
    }
    takerPos = copy(p.chase.m.p);
    const span = Math.max(p.contactAt - p.t, 1e-6);
    takerStride = Math.min(1, (state.time - p.t) / span);
    if (defender) defender = defenderStep(defender, state.ball.p, state.ball.v, state.time - p.t, DT);
    state.world = buildWorld();
  }

  function stepOnce(): void {
    state.time += DT;
    switch (state.phase) {
      case 'runUp': {
        const r = runUp;
        if (r) {
          takerStride = Math.min(1, Math.max(0, (state.time - r.t0) / RUN_UP_TIME));
          takerPos = runUpPosition(spot.ball, settings, takerStride);
        }
        state.world = buildWorld();
        break;
      }
      case 'pushed':
        stepPushed();
        break;
      case 'flight':
      case 'result':
      case 'replay':
        if (shot) stepShot();
        else state.world = buildWorld();
        break;
      default:
        state.world = { ...state.world, t: state.time };
    }
  }

  // ------------------------------------------------------------------ public API
  setup();

  const sim: Sim = {
    state,
    setMode(mode: Mode): void {
      state.mode = mode;
      spot = defaultSpot(mode);
      setup();
    },
    setSpot(req: string | { x: number; z: number }): void {
      if (typeof req === 'string') {
        const found = findSpot(state.mode, req);
        if (found) spot = found;
        else if (state.mode === 'freeKick') {
          const m = /^fk-x(-?\d+)-z(-?\d+)$/.exec(req);
          if (!m) return;
          spot = freeKickSpot({ x: Number(m[1]), z: Number(m[2]) });
        } else return;
      } else {
        if (state.mode !== 'freeKick') return;
        spot = freeKickSpot(req);
      }
      setup();
    },
    setSettings(s: Partial<Settings>): void {
      Object.assign(settings, s);
      if (state.phase === 'aiming') {
        takerPos = takerStand(spot.ball, settings);
        state.world = buildWorld();
      }
    },
    startRunUp(): number {
      if (state.mode === 'penalty') {
        if (state.phase === 'aiming') {
          runUp = { t0: state.time, contactAt: state.time + RUN_UP_TIME };
          takerStride = 0;
          takerPos = runUpPosition(spot.ball, settings, 0);
          state.world = buildWorld();
          setPhase('runUp');
          emit({ type: 'runUpStart', t: state.time, contactAt: runUp.contactAt });
        }
        return runUp ? runUp.contactAt : state.time;
      }
      if (state.mode === 'longShot' && push) return push.contactAt;
      return state.time;
    },
    applyIntent(intent: KickIntent): void {
      const ph = state.phase;
      if (intent.kind === 'push') {
        if (state.mode === 'longShot' && ph === 'aiming') doPush(intent);
        return;
      }
      if (ph === 'aiming' || ph === 'runUp' || ph === 'pushed') doStrike(intent);
    },
    update(dt: number): void {
      if (!(dt > 0)) return;
      acc += Math.min(dt, MAX_FRAME_DT);
      while (acc >= DT - 1e-12) {
        acc -= DT;
        stepOnce();
      }
    },
    resetShot(): void {
      nextNoiseSeed = drawSeed();
      setup();
    },
    on(listener: (e: SimEvent) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    solveAim(
      target: { x: number; y: number },
      speedKmh: number,
      sideSpin: number,
      topSpin: number,
    ): LaunchParams | null {
      const origin = state.phase === 'aiming' || state.phase === 'pushed' ? copy(state.ball.p) : copy(state.ballStart);
      return solveLaunch(origin, target, speedKmh / 3.6, sideSpin, topSpin, env());
    },
    previewPath(intent: KickIntent): Vec3[] {
      const moving = state.phase === 'pushed';
      const origin = state.phase === 'aiming' || moving ? copy(state.ball.p) : copy(state.ballStart);
      let launch: LaunchParams;
      let maxTime = 3;
      if (intent.kind === 'push') {
        const azimuth =
          intent.aim.kind === 'angles'
            ? intent.aim.azimuth
            : Math.atan2(intent.aim.x - origin.x, Math.max(origin.z, 0.1));
        launch = pushLaunch(origin, azimuth, intent.power);
        maxTime = 2.5;
      } else {
        launch = resolve(intent, origin, moving ? copy(state.ball.v) : v3(0, 0, 0), 1);
      }
      const tr = simulate(launch, env(), { maxTime, sampleEvery: 4 });
      const out: Vec3[] = [];
      for (const s of tr.samples) {
        out.push(copy(s.p));
        if (s.p.z < -0.3) break;
      }
      return out;
    },
  };
  return sim;
}
