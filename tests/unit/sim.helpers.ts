// Shared helpers for the sim unit tests (not a test file itself).
import type { KickIntent, Settings, SimEvent } from '../../src/contracts';
import { createSim } from '../../src/sim';

export const SETTINGS: Settings = { controlScheme: 'dial', altitude: 'nairobi', sound: false, footed: 'right' };

export function newSim(seed: number, settings: Partial<Settings> = {}) {
  const sim = createSim({ settings: { ...SETTINGS, ...settings }, seed });
  const events: SimEvent[] = [];
  sim.on((e) => events.push(e));
  return { sim, events };
}

export function strike(
  aim: KickIntent['aim'],
  power: number,
  sideSpin = 0,
  topSpin = 0,
  atMs = 0,
  extra: Partial<KickIntent> = {},
): KickIntent {
  return { kind: 'strike', scheme: 'dial', aim, power, sideSpin, topSpin, atMs, ...extra };
}

/** Advance at 60 Hz until the result (or maxS seconds). */
export function runToResult(sim: ReturnType<typeof createSim>, maxS = 8): void {
  for (let i = 0; i < maxS * 60 && sim.state.phase !== 'result'; i++) sim.update(1 / 60);
}

/** Penalty: run-up, strike at the ideal contact (+ offset ms), play to the result. */
export function penalty(
  seed: number,
  target: { x: number; y: number },
  power: number,
  opts: { disguise?: boolean; offsetMs?: number } = {},
) {
  const { sim, events } = newSim(seed);
  sim.setMode('penalty');
  const contactAt = sim.startRunUp();
  while (sim.state.time < contactAt - 1e-9) sim.update(1 / 240);
  const intent = strike({ kind: 'target', ...target }, power, 0, 0, contactAt * 1000 + (opts.offsetMs ?? 0), {
    disguise: opts.disguise,
  });
  sim.applyIntent(intent);
  return { sim, events };
}
