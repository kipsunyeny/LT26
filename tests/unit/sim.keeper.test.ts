import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../src/physics';
import {
  KEEPER,
  Keeper,
  clampToEnvelope,
  envelopeMeasure,
  keeperGuess,
  lateralReachAt,
  reactionTime,
  type Prediction,
} from '../../src/sim/keeper';
import { penalty, runToResult } from './sim.helpers';

const DT = 1 / 240;
const fixed =
  (x: number, y: number): (() => Prediction) =>
  () => ({ plane: { x, y }, line: { x, y } });

function drive(k: Keeper, x: number, y: number, seconds: number, reaction = 0.2) {
  k.strike({ reaction, guessSide: 0 });
  let maxDx = 0;
  let maxY = 0;
  for (let t = 0; t < seconds; t += DT) {
    k.step(DT, fixed(x, y));
    maxDx = Math.max(maxDx, Math.abs(k.hx - k.base));
    maxY = Math.max(maxY, k.hy);
  }
  return { maxDx, maxY };
}

describe('keeper reach envelope', () => {
  it('envelope: 2.9 m either side, 2.2 m high', () => {
    expect(lateralReachAt(KEEPER.envCentreY)).toBeCloseTo(2.9, 9);
    expect(envelopeMeasure(2.9, 1.0)).toBeCloseTo(1, 9);
    expect(envelopeMeasure(0, 2.2)).toBeCloseTo(1, 9);
    expect(clampToEnvelope(0, 0, 3.5).y).toBeCloseTo(2.2, 9);
    expect(clampToEnvelope(0, 6, 1.0).x).toBeCloseTo(2.9, 9);
    const c = clampToEnvelope(0.5, 5, 2.4);
    expect(envelopeMeasure(c.x - 0.5, c.y)).toBeLessThanOrEqual(1 + 1e-9);
    expect(clampToEnvelope(0, 1, 1.2)).toEqual({ x: 1, y: 1.2 });
  });

  it('hands never leave the envelope around the set position, and reach its edge in time', () => {
    for (const [x, y] of [
      [4, 1.0],
      [-4, 0.3],
      [0, 3],
      [2.2, 2.3],
    ]) {
      const k = new Keeper(0, 0.15);
      // Targets beyond the reach make the keeper side-step; within 0.6 s (a penalty) that is small.
      const r = drive(k, x, y, 0.6);
      expect(r.maxDx).toBeLessThanOrEqual(2.9 + 1e-9);
      expect(r.maxY).toBeLessThanOrEqual(2.2 + 1e-9);
      expect(Math.abs(k.base)).toBeLessThan(0.8); // side-steps only (≤ 3 m/s, starting after the reaction)
    }
    const low = new Keeper(0, 0.15);
    drive(low, 2.7, 0.5, 1.2);
    expect(low.hx).toBeCloseTo(2.7, 1);
    expect(low.hy).toBeCloseTo(0.5, 1);
    const high = new Keeper(0, 0.15);
    drive(high, 0, 2.15, 1.2);
    expect(high.hy).toBeCloseTo(2.15, 1);
  });

  it('dive kinematics: a full-stretch dive takes ≈0.5 s, a 0.5 m reach ≈0.2 s', () => {
    const timeTo = (x: number): number => {
      const k = new Keeper(0, 0.15);
      k.strike({ reaction: 0, guessSide: 0 });
      for (let t = 0; t < 2; t += DT) {
        k.step(DT, fixed(x, 1.0));
        if (Math.abs(k.hx - x) < 0.05) return t;
      }
      return Infinity;
    };
    const full = timeTo(2.8);
    const short = timeTo(0.5);
    expect(full).toBeGreaterThan(0.4);
    expect(full).toBeLessThan(0.65);
    expect(short).toBeGreaterThan(0.12);
    expect(short).toBeLessThan(0.28);
  });

  it('colliders: two hand spheres of radius 0.12 plus a body capsule', () => {
    const cols = new Keeper(0, 0.15).colliders();
    expect(cols.map((c) => c.tag)).toEqual(['keeperHand', 'keeperHand', 'keeperBody']);
    expect(cols[0].kind === 'sphere' && cols[0].radius).toBe(0.12);
  });
});

describe('keeper reaction and read', () => {
  it('reaction time lies in 0.20–0.25 s and the dive starts no earlier', () => {
    expect(reactionTime(0)).toBeCloseTo(0.2, 12);
    expect(reactionTime(1)).toBeCloseTo(0.25, 12);
    const seen: number[] = [];
    for (let seed = 1; seed <= 30; seed++) {
      const { sim, events } = penalty(seed, { x: 1.5, y: 1 }, 0.5);
      runToResult(sim);
      const kick = events.find((e) => e.type === 'kick');
      const dive = events.find((e) => e.type === 'keeperDive');
      expect(kick && dive).toBeTruthy();
      if (kick && dive) seen.push(dive.t - kick.t);
    }
    for (const d of seen) {
      expect(d).toBeGreaterThanOrEqual(0.2 - 1e-9);
      expect(d).toBeLessThanOrEqual(0.25 + 1 / 240 + 1e-9);
    }
    expect(Math.max(...seen) - Math.min(...seen)).toBeGreaterThan(0.02);
  });

  it('a keeper without a guess does not move before his reaction time', () => {
    const k = new Keeper(0, 0.15);
    k.strike({ reaction: 0.22, guessSide: 0 });
    for (let t = 0; t < 0.215; t += DT) k.step(DT, fixed(2.5, 1));
    expect(k.hx).toBe(0);
    for (let t = 0; t < 0.05; t += DT) k.step(DT, fixed(2.5, 1));
    expect(k.hx).toBeGreaterThan(0);
  });

  it('keeperGuess follows the cue 65 % of the time; disguise flips the cue', () => {
    const rng = mulberry32(5);
    let follow = 0;
    let disguisedRight = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      if (keeperGuess(1, false, rng()) === 1) follow++;
      if (keeperGuess(1, true, rng()) === 1) disguisedRight++;
    }
    expect(follow / n).toBeGreaterThan(0.58);
    expect(follow / n).toBeLessThan(0.72);
    expect(disguisedRight / n).toBeGreaterThan(0.28);
    expect(disguisedRight / n).toBeLessThan(0.42);
    expect(keeperGuess(0, false, 0.1)).toBe(0);
  });

  it('in play: the pre-shift goes to the aimed side ≈65 % over many seeds, ≈35 % with disguise', () => {
    const fraction = (disguise: boolean): number => {
      let right = 0;
      const n = 200;
      for (let seed = 1; seed <= n; seed++) {
        const { sim } = penalty(seed, { x: 2.5, y: 1 }, 0.85, { disguise });
        for (let i = 0; i < 43; i++) sim.update(1 / 240); // 0.18 s: before any reaction
        const h = sim.state.world.keeper.hands;
        if ((h[0].x + h[1].x) / 2 > 0) right++;
      }
      return right / n;
    };
    const open = fraction(false);
    const disguised = fraction(true);
    console.log(
      `[keeper] guessed aimed side: open ${(open * 100).toFixed(1)} %, disguised ${(disguised * 100).toFixed(1)} %`,
    );
    expect(Math.abs(open - 0.65)).toBeLessThanOrEqual(0.07);
    expect(Math.abs(disguised - 0.35)).toBeLessThanOrEqual(0.07);
  });
});
