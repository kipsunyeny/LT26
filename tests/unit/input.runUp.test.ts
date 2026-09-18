import { describe, expect, it } from 'vitest';
import {
  TIMING_IDEAL_POS,
  formatTiming,
  gesturePlan,
  timingErrorMs,
  timingGrade,
  timingMarkerPos,
  timingPowerMultiplier,
  timingScatterDeg,
  timingWindowWidth,
} from '../../src/input/runUp';

describe('run-up timing', () => {
  it('full power inside ±80 ms, linear to 75 % at 400 ms, clamped beyond', () => {
    expect(timingPowerMultiplier(0)).toBe(1);
    expect(timingPowerMultiplier(80)).toBe(1);
    expect(timingPowerMultiplier(-80)).toBe(1);
    expect(timingPowerMultiplier(240)).toBeCloseTo(0.875, 12);
    expect(timingPowerMultiplier(-400)).toBeCloseTo(0.75, 12);
    expect(timingPowerMultiplier(2000)).toBeCloseTo(0.75, 12);
  });

  it('extra scatter 0 in the window, up to 3° at 400 ms', () => {
    expect(timingScatterDeg(50)).toBe(0);
    expect(timingScatterDeg(240)).toBeCloseTo(1.5, 12);
    expect(timingScatterDeg(-900)).toBe(3);
  });

  it('grades and labels', () => {
    expect(timingErrorMs(1030, 1000)).toBe(30);
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
});
