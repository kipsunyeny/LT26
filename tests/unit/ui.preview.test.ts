import { describe, expect, it } from 'vitest';
import type { KickIntent } from '../../src/contracts';
import { createPreviewCache, previewKey } from '../../src/ui/preview';

const intent = (x: number, power = 0.7): KickIntent => ({
  kind: 'strike',
  scheme: 'dial',
  aim: { kind: 'target', x, y: 1.5 },
  power,
  sideSpin: 4,
  topSpin: 0,
  atMs: 0,
});

describe('aim preview cache', () => {
  it('keys on quantised aim, power, spins and context, not on the timestamp', () => {
    expect(previewKey({ ...intent(1), atMs: 5 }, 'c')).toBe(previewKey({ ...intent(1), atMs: 99 }, 'c'));
    expect(previewKey(intent(1.001), 'c')).toBe(previewKey(intent(1.002), 'c'));
    expect(previewKey(intent(1), 'c')).not.toBe(previewKey(intent(1.2), 'c'));
    expect(previewKey(intent(1), 'fk-centre|sea')).not.toBe(previewKey(intent(1), 'fk-centre|nairobi'));
    expect(previewKey(intent(1, 0.7), 'c')).not.toBe(previewKey(intent(1, 0.8), 'c'));
  });

  it('computes at most once per 100 ms (≤ 10 Hz) and serves repeats from the cache', () => {
    const c = createPreviewCache();
    let calls = 0;
    const compute = () => {
      calls += 1;
      return [{ x: calls, y: 0, z: 0 }];
    };
    expect(c.get('a', compute, 0)).toEqual([{ x: 1, y: 0, z: 0 }]);
    expect(c.get('b', compute, 16)).toBeUndefined(); // throttled
    expect(c.get('a', compute, 32)).toEqual([{ x: 1, y: 0, z: 0 }]); // cache hit, no call
    expect(c.get('b', compute, 100)).toEqual([{ x: 2, y: 0, z: 0 }]);
    // A 60 fps drag over 1 s with a new key every frame computes ≤ 10 times.
    const before = c.computations;
    for (let f = 1; f <= 60; f += 1) c.get(`drag${f}`, compute, 100 + f * 16.7);
    expect(c.computations - before).toBeLessThanOrEqual(10);
    expect(calls).toBe(c.computations);
  });

  it('evicts the least recently used entry', () => {
    const c = createPreviewCache(0, 2);
    let calls = 0;
    const compute = () => {
      calls += 1;
      return [];
    };
    c.get('a', compute, 0);
    c.get('b', compute, 1);
    c.get('a', compute, 2);
    c.get('c', compute, 3); // evicts b
    c.get('a', compute, 4);
    expect(calls).toBe(3);
    c.get('b', compute, 5);
    expect(calls).toBe(4);
  });
});
