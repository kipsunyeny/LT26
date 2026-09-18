import { describe, expect, it } from 'vitest';
import type { ShotResult, ShotSummary } from '../../src/contracts';
import { LOG_KEY, cornerDistance, createSessionLog } from '../../src/data/sessionLog';

class MemStorage {
  m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

function shot(result: ShotResult, x: number, y: number, miss: number, spotKey = 'fk-centre'): ShotSummary {
  return {
    mode: 'freeKick',
    spotKey,
    result,
    speedKmh: 90,
    spinRps: 8,
    lateralCurveM: 2,
    apexM: 2.5,
    timeToGoalS: 1.1,
    crossing: { x, y },
    missDistanceM: miss,
    path: [
      { x: 0, y: 0.11, z: 22 },
      { x: x / 2, y: 2, z: 11 },
      { x, y, z: 0 },
    ],
  };
}

describe('session log', () => {
  it('counts attempts, goals and the average miss of non-goals per spot', () => {
    const log = createSessionLog(new MemStorage() as unknown as Storage);
    log.record(shot('goal', 1, 1, 0));
    log.record(shot('miss', 5, 1, 1.34));
    log.record(shot('saved', 2, 1, 0.66));
    const s = log.get('fk-centre');
    expect(s).toMatchObject({ spotKey: 'fk-centre', mode: 'freeKick', attempts: 3, goals: 1 });
    expect(s?.avgMissM).toBeCloseTo(1.0, 9);
    expect(log.get('nope')).toBeNull();
    log.record(shot('miss', 5, 1, 2, 'fk-left-d'));
    expect(log.all().map((a) => a.spotKey)).toEqual(['fk-centre', 'fk-left-d']);
  });

  it('best kick: a goal closest to a corner, else the smallest miss', () => {
    const log = createSessionLog(null);
    log.record(shot('miss', 5, 1, 1.34));
    log.record(shot('post', 3.8, 1, 0.14));
    expect(log.get('fk-centre')?.best?.missDistanceM).toBeCloseTo(0.14, 9);
    log.record(shot('goal', 0, 1.2, 0));
    expect(log.get('fk-centre')?.best?.crossing).toEqual({ x: 0, y: 1.2 });
    log.record(shot('goal', -3.3, 2.1, 0));
    log.record(shot('goal', 2.0, 0.5, 0));
    log.record(shot('miss', 3.7, 1, 0.04));
    const best = log.get('fk-centre')?.best;
    expect(best?.crossing).toEqual({ x: -3.3, y: 2.1 });
    expect(best?.path.length).toBe(3);
    expect(cornerDistance(shot('goal', 3.66, 2.44, 0))).toBeCloseTo(0, 9);
  });

  it('persists across instances and resets', () => {
    const st = new MemStorage();
    const a = createSessionLog(st as unknown as Storage);
    a.record(shot('goal', 3, 2, 0));
    a.record(shot('wall', 0, 0, 3.1));
    expect(st.m.has(LOG_KEY)).toBe(true);
    const b = createSessionLog(st as unknown as Storage);
    expect(b.get('fk-centre')).toEqual(a.get('fk-centre'));
    b.reset();
    expect(b.all()).toEqual([]);
    expect(st.m.has(LOG_KEY)).toBe(false);
    expect(createSessionLog(st as unknown as Storage).all()).toEqual([]);
  });

  it('tolerates corrupt storage and throwing storage', () => {
    const st = new MemStorage();
    for (const bad of ['{nope', 'null', '[]', '{"v":2,"spots":{}}', '{"v":1,"spots":{"x":{"spotKey":"y"}}}']) {
      st.setItem(LOG_KEY, bad);
      const log = createSessionLog(st as unknown as Storage);
      expect(log.all()).toEqual([]);
      expect(log.record(shot('goal', 1, 1, 0)).attempts).toBe(1);
    }
    st.setItem(
      LOG_KEY,
      JSON.stringify({
        v: 1,
        spots: {
          ok: { spotKey: 'ok', mode: 'penalty', attempts: 2, goals: 1, missSum: 1, missCount: 1, best: { junk: true } },
          bad: { spotKey: 'bad', mode: 'penalty', attempts: 1, goals: 5, missSum: 0, missCount: 0, best: null },
        },
      }),
    );
    const log = createSessionLog(st as unknown as Storage);
    expect(log.get('ok')).toMatchObject({ attempts: 2, goals: 1, avgMissM: 1, best: null });
    expect(log.get('bad')).toBeNull();
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage;
    const t = createSessionLog(throwing);
    expect(t.record(shot('goal', 1, 1, 0)).goals).toBe(1);
    expect(() => t.reset()).not.toThrow();
  });
});
