import { describe, expect, it } from 'vitest';
import {
  AIM_X_LIMIT,
  AIM_Y_MAX,
  KNOB_CURVE,
  KNOB_DIP,
  clampAim,
  clampKnob,
  curveLabel,
  dialIntent,
  dipLabel,
  knobDragValue,
  powerOscillation,
  snap,
} from '../../src/input/dial';

describe('dial knobs', () => {
  it('clamp curve to ±10 and dip to ±6 rev/s', () => {
    expect(clampKnob(12, KNOB_CURVE)).toBe(10);
    expect(clampKnob(-99, KNOB_CURVE)).toBe(-10);
    expect(clampKnob(7, KNOB_DIP)).toBe(6);
    expect(clampKnob(-6.2, KNOB_DIP)).toBe(-6);
    expect(clampKnob(3.26, KNOB_CURVE)).toBe(3.5);
  });

  it('dragging up/right increases, down/left decreases, in 0.5 steps, clamped', () => {
    expect(knobDragValue(0, 0, -50, KNOB_CURVE)).toBe(5);
    expect(knobDragValue(0, 30, 0, KNOB_CURVE)).toBe(3);
    expect(knobDragValue(2, 0, 40, KNOB_CURVE)).toBe(-2);
    expect(knobDragValue(0, 0, -1000, KNOB_CURVE)).toBe(10);
    expect(knobDragValue(0, 0, 1000, KNOB_DIP)).toBe(-6);
    expect(knobDragValue(0, 0, -32, KNOB_DIP)).toBe(2);
  });

  it('snap never returns −0', () => {
    expect(Object.is(snap(-0.1, 0.5), 0)).toBe(true);
  });
});

describe('power bar', () => {
  it('fills 0 → 1 and empties back over one period', () => {
    expect(powerOscillation(0)).toBe(0);
    expect(powerOscillation(400)).toBeCloseTo(0.5, 9);
    expect(powerOscillation(800)).toBeCloseTo(1, 9);
    expect(powerOscillation(1200)).toBeCloseTo(0.5, 9);
    expect(powerOscillation(1600)).toBeCloseTo(0, 9);
    expect(powerOscillation(2000)).toBeCloseTo(0.5, 9);
  });
});

describe('dial intent', () => {
  it('is a target aim with clamped numeric values, repeatable', () => {
    const s = { target: { x: 2.5, y: 1.8 }, power: 1.3, sideSpin: -14, topSpin: 9 };
    const a = dialIntent(s, 'strike', 1234);
    expect(a).toEqual({
      kind: 'strike',
      scheme: 'dial',
      aim: { kind: 'target', x: 2.5, y: 1.8 },
      power: 1,
      sideSpin: -10,
      topSpin: 6,
      atMs: 1234,
    });
    expect(dialIntent(s, 'strike', 1234)).toEqual(a);
    expect(dialIntent(s, 'push', 0).kind).toBe('push');
  });

  it('reticle may go beyond the frame (mis-aim) but stays bounded', () => {
    expect(clampAim({ x: 5, y: 3 })).toEqual({ x: 5, y: 3 });
    expect(clampAim({ x: 40, y: -2 })).toEqual({ x: AIM_X_LIMIT, y: 0 });
    expect(clampAim({ x: -40, y: 20 })).toEqual({ x: -AIM_X_LIMIT, y: AIM_Y_MAX });
  });
});

describe('foot labels', () => {
  it('mirror inside/outside for left-footers; physics sign unchanged', () => {
    expect(curveLabel(-5, 'right')).toMatch(/^inside · curls left/);
    expect(curveLabel(5, 'right')).toMatch(/^outside · curls right/);
    expect(curveLabel(5, 'left')).toMatch(/^inside · curls right/);
    expect(curveLabel(-5, 'left')).toMatch(/^outside · curls left/);
    expect(curveLabel(0, 'left')).toBe('straight');
    expect(dipLabel(3)).toMatch(/dips/);
    expect(dipLabel(-3)).toMatch(/floats/);
  });
});
