import { describe, expect, it } from 'vitest';
import type { BallState, ContactEvent, LaunchParams, ShotResult, Vec3 } from '../../src/contracts';
import { goalFrameColliders, launchState, solveLaunch, stepBall } from '../../src/physics';
import { ShotJudge, mouthDistance } from '../../src/sim/rules';
import { penalty, runToResult } from './sim.helpers';

const ZERO_NOISE = { sample: (): Vec3 => ({ x: 0, y: 0, z: 0 }) };
const ENV = { rho: 1.2, seed: 1 };

/** Straight synthetic path from a to b over `dur` s, then continuing; contacts injected at given steps. */
function synthetic(a: Vec3, b: Vec3, dur: number, inject: Record<number, ContactEvent['tag']> = {}, caughtAt = -1) {
  const launch: LaunchParams = { origin: a, speed: 20, azimuth: 0, elevation: 0, sideSpin: 0, topSpin: 0 };
  const judge = new ShotJudge('freeKick', 'fk-centre', launch);
  const v = { x: (b.x - a.x) / dur, y: (b.y - a.y) / dur, z: (b.z - a.z) / dur };
  const dt = 1 / 240;
  let prev: BallState = { t: 0, p: a, v, w: { x: 0, y: 0, z: 0 } };
  for (let i = 1; i < 240 * 7; i++) {
    const t = i * dt;
    const next: BallState = { t, p: { x: a.x + v.x * t, y: a.y + v.y * t, z: a.z + v.z * t }, v, w: prev.w };
    const tag = inject[i];
    const contacts: ContactEvent[] = tag ? [{ t, tag, point: next.p, speedBefore: 20, colliderIndex: 0 }] : [];
    const r = judge.step(prev, next, contacts, i === caughtAt);
    if (r.decision) return judge.summary(20, 0);
    prev = next;
  }
  return judge.summary(20, 0);
}

/** Real physics against the goal frame only. */
function real(
  target: { x: number; y: number },
  speed = 18,
): { result: ShotResult; crossing: { x: number; y: number } | null; miss: number } {
  const origin = { x: 0, y: 0.11, z: 11 };
  const l = solveLaunch(origin, target, speed, 0, 0, ENV);
  if (!l) throw new Error('unsolved');
  const judge = new ShotJudge('penalty', 'pk-spot', l);
  const cols = goalFrameColliders();
  let s = launchState(l);
  for (let i = 0; i < 240 * 7; i++) {
    const r = stepBall(s, 1 / 240, ENV, ZERO_NOISE, cols);
    const j = judge.step(
      s,
      r.state,
      r.contacts.filter((c) => c.tag !== 'ground'),
      false,
    );
    s = r.state;
    if (j.decision) break;
  }
  const sum = judge.summary(l.speed, 0);
  return { result: sum.result, crossing: sum.crossing, miss: sum.missDistanceM };
}

describe('rules on synthetic trajectories', () => {
  it('goal = wholly over the line inside the posts and under the bar', () => {
    const g = synthetic({ x: 0, y: 1, z: 10 }, { x: 1, y: 1, z: -1 }, 1);
    expect(g.result).toBe('goal');
    expect(g.missDistanceM).toBe(0);
    expect(g.crossing?.x).toBeCloseTo(10 / 11, 6);
    expect(g.timeToGoalS).toBeCloseTo(10 / 11, 6);
  });
  it('wide and over are misses with the distance to the frame', () => {
    const wide = synthetic({ x: 0, y: 1, z: 10 }, { x: 5.5, y: 1, z: -1 }, 1);
    expect(wide.result).toBe('miss');
    expect(wide.missDistanceM).toBeCloseTo(5 - 3.66, 6);
    const over = synthetic({ x: 0, y: 1, z: 10 }, { x: 0, y: 4.3, z: -1 }, 1);
    expect(over.result).toBe('miss');
    expect(over.missDistanceM).toBeCloseTo(4 - 2.44, 6);
  });
  it('contact priorities: in off the keeper/post is a goal; otherwise saved > post/bar > wall > miss', () => {
    expect(synthetic({ x: 0, y: 1, z: 10 }, { x: 0, y: 1, z: -1 }, 1, { 100: 'keeperHand' }).result).toBe('goal');
    expect(synthetic({ x: 0, y: 1, z: 10 }, { x: 6, y: 1, z: -1 }, 1, { 100: 'keeperHand', 150: 'post' }).result).toBe(
      'saved',
    );
    expect(synthetic({ x: 0, y: 1, z: 10 }, { x: 6, y: 1, z: -1 }, 1, { 100: 'wall', 150: 'bar' }).result).toBe('bar');
    expect(synthetic({ x: 0, y: 1, z: 10 }, { x: 6, y: 1, z: -1 }, 1, { 100: 'defender' }).result).toBe('wall');
    const caught = synthetic({ x: 0, y: 1, z: 10 }, { x: 0, y: 1, z: -1 }, 1, { 100: 'keeperHand' }, 100);
    expect(caught.result).toBe('caught');
    expect(caught.crossing).toBeNull();
    expect(caught.timeToGoalS).toBeCloseTo(100 / 240, 9);
  });
  it('a ball that never reaches the line is decided (stopped / timeout) with its closest approach', () => {
    const s = synthetic({ x: 0, y: 1, z: 10 }, { x: 0, y: 1, z: 9.9 }, 6);
    expect(s.result).toBe('miss');
    expect(s.missDistanceM).toBeGreaterThan(9.8);
  });
  it('mouth distance', () => {
    expect(mouthDistance(0, 1)).toBe(0);
    expect(mouthDistance(4.66, 3.44)).toBeCloseTo(Math.SQRT2, 9);
    expect(mouthDistance(-5, 1)).toBeCloseTo(1.34, 9);
  });
});

describe('rules on real trajectories (physics + goal frame)', () => {
  it('goal, post-and-in, post-and-out, bar, wide, over', () => {
    expect(real({ x: 2, y: 1 }).result).toBe('goal');
    const postIn = real({ x: 3.58, y: 1 });
    expect(postIn.result).toBe('goal');
    const postOut = real({ x: 3.84, y: 1 });
    expect(postOut.result).toBe('post');
    expect(real({ x: 0, y: 2.62 }).result).toBe('bar');
    const wide = real({ x: 4.5, y: 1 });
    expect(wide.result).toBe('miss');
    expect(wide.miss).toBeCloseTo(4.5 - 3.66, 1);
    const over = real({ x: 0, y: 3.2 });
    expect(over.result).toBe('miss');
    expect(over.miss).toBeGreaterThan(0.5);
  });
});

describe('keeper saves: caught below 60 km/h, parried above', () => {
  it('every save event matches the contact speed threshold', () => {
    let caught = 0;
    let parried = 0;
    for (let seed = 1; seed <= 16; seed++) {
      for (const power of [0, 0.85]) {
        const { sim, events } = penalty(seed, { x: 0.3, y: 1.1 }, power);
        runToResult(sim);
        const first = events.find(
          (e) => e.type === 'contact' && (e.contact.tag === 'keeperHand' || e.contact.tag === 'keeperBody'),
        );
        const save = events.find((e) => e.type === 'save');
        if (!first || first.type !== 'contact' || !save || save.type !== 'save') continue;
        const slow = first.contact.speedBefore < 60 / 3.6;
        expect(save.caught).toBe(slow);
        if (save.caught) {
          caught++;
          expect(sim.state.lastShot?.result).toBe('caught');
        } else parried++;
      }
    }
    expect(caught).toBeGreaterThan(0);
    expect(parried).toBeGreaterThan(0);
  });
});
