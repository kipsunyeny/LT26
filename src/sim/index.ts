// STUB (Phase 0) — replaced by the gameplay/sim engineer. Minimal inert Sim so the app boots.
import type { GameState, Settings, Sim, WorldSnapshot } from '../contracts';

export interface CreateSimOptions {
  settings: Settings;
  seed?: number;
}

export function createSim(opts: CreateSimOptions): Sim {
  const v0 = { x: 0, y: 0, z: 0 };
  const world: WorldSnapshot = {
    t: 0,
    ball: { p: { x: 0, y: 0.11, z: 25 }, w: v0 },
    keeper: { p: { x: 0, y: 0, z: 0.3 }, lean: 0, lift: 0, hands: [v0, v0] },
    wall: [],
    defender: null,
    taker: { p: { x: -0.8, y: 0, z: 27 }, stride: 0 },
  };
  const state: GameState = {
    mode: 'freeKick',
    phase: 'aiming',
    spotKey: 'fk-centre',
    ballStart: world.ball.p,
    settings: opts.settings,
    world,
    ball: { t: 0, p: world.ball.p, v: v0, w: v0 },
    lastShot: null,
    lastRecording: null,
    time: 0,
  };
  return {
    state,
    setMode: (m) => void (state.mode = m),
    setSpot: () => undefined,
    setSettings: (s) => void Object.assign(state.settings, s),
    startRunUp: () => state.time,
    applyIntent: () => undefined,
    update: (dt) => void (state.time += dt),
    resetShot: () => undefined,
    on: () => () => undefined,
    solveAim: () => null,
    previewPath: () => [],
  };
}
