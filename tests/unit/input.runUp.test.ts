import { describe, expect, it } from 'vitest';
import {
  TIMING_IDEAL_POS,
  formatTiming,
  gesturePlan,
  releaseAllowed,
  timingGrade,
  timingMarkerPos,
  timingWindowWidth,
} from '../../src/input/runUp';

describe('run-up timing', () => {
  it('grades and labels', () => {
    expect(timingGrade(30)).toBe('perfect');
    expect(timingGrade(-120)).toBe('early');
    expect(timingGrade(120)).toBe('late');
    expect(formatTiming(35.4)).toBe('+35 ms · perfect');
    expect(formatTiming(-120)).toBe('−120 ms · early');
    expect(formatTiming(0)).toBe('±0 ms · perfect');
  });

  it('marker reaches the ideal position at contact and keeps going when late', () => {
    expect(timingMarkerPos(1000, 1000, 1800)).toBe(0);
    expect(timingMarkerPos(1800, 1000, 1800)).toBeCloseTo(TIMING_IDEAL_POS, 12);
    expect(timingMarkerPos(1900, 1000, 1800)).toBeGreaterThan(TIMING_IDEAL_POS);
    expect(timingMarkerPos(9000, 1000, 1800)).toBe(1);
    expect(timingWindowWidth(1000, 1800)).toBeCloseTo((80 / 800) * TIMING_IDEAL_POS, 12);
  });
});

describe('gesture plan per mode and phase', () => {
  it('free kick strikes directly; penalty runs up; long shot pushes then runs onto the ball', () => {
    expect(gesturePlan('freeKick', 'aiming')).toEqual({ kind: 'strike', runUp: false });
    expect(gesturePlan('freeKick', 'setup')).toEqual({ kind: 'strike', runUp: false });
    expect(gesturePlan('penalty', 'aiming')).toEqual({ kind: 'strike', runUp: true });
    expect(gesturePlan('penalty', 'runUp')).toEqual({ kind: 'strike', runUp: false });
    expect(gesturePlan('longShot', 'aiming')).toEqual({ kind: 'push', runUp: false });
    expect(gesturePlan('longShot', 'pushed')).toEqual({ kind: 'strike', runUp: true });
    expect(gesturePlan('longShot', 'runUp')).toEqual({ kind: 'strike', runUp: false });
  });

  it('ignores gestures while the ball is in flight or a result is shown', () => {
    for (const p of ['flight', 'result', 'replay']) {
      expect(gesturePlan('freeKick', p)).toBeNull();
      expect(gesturePlan('penalty', p)).toBeNull();
    }
    expect(gesturePlan('freeKick', 'runUp')).toBeNull();
    expect(gesturePlan('penalty', 'pushed')).toBeNull();
  });

  it('a release only emits if the mode is unchanged and the phase still allows that gesture', () => {
    const strikeRun = { kind: 'strike' as const, runUp: true };
    expect(releaseAllowed(strikeRun, 'penalty', 'penalty', 'runUp')).toBe(true);
    expect(releaseAllowed(strikeRun, 'penalty', 'penalty', 'aiming')).toBe(true);
    expect(releaseAllowed(strikeRun, 'penalty', 'freeKick', 'aiming')).toBe(false);
    expect(releaseAllowed(strikeRun, 'penalty', 'penalty', 'flight')).toBe(false);
    const push = { kind: 'push' as const, runUp: false };
    expect(releaseAllowed(push, 'longShot', 'longShot', 'aiming')).toBe(true);
    expect(releaseAllowed(push, 'longShot', 'longShot', 'pushed')).toBe(false);
  });
});
