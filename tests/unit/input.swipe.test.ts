import { describe, expect, it } from 'vitest';
import type { PointerSample } from '../../src/contracts';
import {
  CONTACT_BAND_MIN_PX,
  CSS_PX_PER_INCH,
  CSS_PX_PER_INCH_COARSE,
  CSS_PX_PER_METRE,
  CSS_PX_PER_METRE_COARSE,
  contactBandPx,
  contactFromStart,
  pxPerMetreFor,
  tapStrikeIntent,
  FINGER_MAX_MPS,
  FINGER_MIN_MPS,
  basisFromProjection,
  powerFromFingerSpeed,
  releaseSpeedMps,
  signedCurvature,
  speedKmhFromPower,
  swipeToIntent,
} from '../../src/input/swipe';
import { createFallbackProjector } from '../../src/ui/projector';

const BALL = { x: 640, y: 640, r: 14 };

/** Uniform-speed path from (x0,y0) to (x1,y1) with a sideways bow (bow > 0 = bulges to screen right). */
function path(x0: number, y0: number, x1: number, y1: number, durationMs: number, bow = 0, n = 16): PointerSample[] {
  const out: PointerSample[] = [];
  const L = Math.hypot(x1 - x0, y1 - y0);
  const nx = -(y1 - y0) / L;
  const ny = (x1 - x0) / L;
  for (let i = 0; i <= n; i += 1) {
    const f = i / n;
    const b = bow * Math.sin(Math.PI * f);
    out.push({ x: x0 + (x1 - x0) * f + nx * b, y: y0 + (y1 - y0) * f + ny * b, t: 1000 + durationMs * f });
  }
  return out;
}

const deg = (r: number): number => (r * 180) / Math.PI;

describe('swipeToIntent', () => {
  it('straight fast swipe up from the ball centre → high power, no spin, aimed at goal centre', () => {
    // 340 px in 30 ms = 11.3 px/ms ≈ 3.0 m/s at 96 px/in.
    const i = swipeToIntent(path(640, 640, 640, 300, 30), BALL, { atMs: 5 });
    expect(i).not.toBeNull();
    expect(i!.power).toBeGreaterThan(0.95);
    expect(i!.sideSpin).toBe(0);
    expect(i!.topSpin).toBe(0);
    expect(i!.aim.kind).toBe('angles');
    if (i!.aim.kind === 'angles') expect(Math.abs(deg(i!.aim.azimuth))).toBeLessThan(0.01);
    expect(i!.scheme).toBe('swipe');
    expect(i!.kind).toBe('strike');
    expect(i!.atMs).toBe(5);
  });

  it('a swipe that hooks right (bows left of its chord) → sideSpin > 0', () => {
    const i = swipeToIntent(path(640, 640, 640, 300, 60, -50), BALL, { atMs: 0 });
    expect(i!.sideSpin).toBeGreaterThan(3);
    expect(i!.sideSpin).toBeLessThanOrEqual(10);
  });

  it('a swipe that hooks left → sideSpin < 0, and the magnitude grows with the bow', () => {
    const small = swipeToIntent(path(640, 640, 640, 300, 60, 20), BALL, { atMs: 0 })!;
    const big = swipeToIntent(path(640, 640, 640, 300, 60, 45), BALL, { atMs: 0 })!;
    expect(small.sideSpin).toBeLessThan(0);
    expect(big.sideSpin).toBeLessThan(small.sideSpin);
    const huge = swipeToIntent(path(640, 640, 640, 300, 60, 200), BALL, { atMs: 0 })!;
    expect(huge.sideSpin).toBe(-10);
  });

  it('slow swipe → low power (40 km/h floor)', () => {
    const i = swipeToIntent(path(640, 640, 640, 340, 1500), BALL, { atMs: 0 })!;
    expect(i.power).toBeLessThan(0.05);
    expect(speedKmhFromPower(i.power)).toBeLessThan(44);
  });

  it('start on the top of the ball → top spin and a lower launch than a centre start', () => {
    const centre = swipeToIntent(path(640, 640, 640, 300, 60), BALL, { atMs: 0 })!;
    const top = swipeToIntent(path(640, 640 - 40, 640, 300, 60), BALL, { atMs: 0 })!;
    expect(top.topSpin).toBeGreaterThan(0);
    if (top.aim.kind !== 'angles' || centre.aim.kind !== 'angles') throw new Error('angles expected');
    expect(top.aim.elevation).toBeLessThan(centre.aim.elevation);
    expect(deg(top.aim.elevation)).toBeCloseTo(2, 5);
  });

  it('start on the bottom of the ball → back spin and a higher (lofted) launch', () => {
    const centre = swipeToIntent(path(640, 640, 640, 300, 60), BALL, { atMs: 0 })!;
    const bottom = swipeToIntent(path(640, 640 + 40, 640, 300, 60), BALL, { atMs: 0 })!;
    expect(bottom.topSpin).toBeLessThan(0);
    if (bottom.aim.kind !== 'angles' || centre.aim.kind !== 'angles') throw new Error('angles expected');
    expect(bottom.aim.elevation).toBeGreaterThan(centre.aim.elevation);
    expect(deg(bottom.aim.elevation)).toBeCloseTo(20, 5);
  });

  it('direction → azimuth: up-right is positive, up-left negative', () => {
    const r = swipeToIntent(path(640, 640, 740, 340, 60), BALL, { atMs: 0 })!;
    const l = swipeToIntent(path(640, 640, 540, 340, 60), BALL, { atMs: 0 })!;
    if (r.aim.kind !== 'angles' || l.aim.kind !== 'angles') throw new Error('angles expected');
    expect(r.aim.azimuth).toBeGreaterThan(0);
    expect(l.aim.azimuth).toBeCloseTo(-r.aim.azimuth, 9);
  });

  it('taps, backwards and sideways swipes produce no kick', () => {
    expect(swipeToIntent(path(640, 640, 645, 630, 50), BALL, { atMs: 0 })).toBeNull();
    expect(swipeToIntent(path(640, 640, 640, 780, 50), BALL, { atMs: 0 })).toBeNull();
    expect(swipeToIntent(path(640, 640, 900, 640, 50), BALL, { atMs: 0 })).toBeNull();
    expect(swipeToIntent([{ x: 1, y: 1, t: 0 }], BALL, { atMs: 0 })).toBeNull();
  });

  it('push kind is passed through (long shot first touch)', () => {
    expect(swipeToIntent(path(640, 640, 640, 400, 200), BALL, { atMs: 0, kind: 'push' })!.kind).toBe('push');
  });

  it('reads the direction on the pitch: foreshortened forward axis narrows the angle', () => {
    const basis = { forward: { x: 0, y: -0.4 }, right: { x: 1, y: 0 }, baseAzimuth: 0 };
    const i = swipeToIntent(path(640, 640, 740, 540, 60), BALL, { atMs: 0, basis })!;
    if (i.aim.kind !== 'angles') throw new Error('angles expected');
    expect(deg(i.aim.azimuth)).toBeCloseTo(deg(Math.atan2(1, 2.5)), 6);
  });

  it('with a perspective projection, straight up the screen aims at the goal centre from any spot', () => {
    for (const ball of [
      { x: 0, y: 0.11, z: 22 },
      { x: -8, y: 0.11, z: 20 },
      { x: 10, y: 0.11, z: 26 },
    ]) {
      const proj = createFallbackProjector(ball, 1280, 800);
      const basis = basisFromProjection(ball, (p) => proj.worldToScreen(p))!;
      expect(basis).not.toBeNull();
      const s = proj.worldToScreen(ball);
      const i = swipeToIntent(path(s.x, s.y, s.x, s.y - 300, 60), { x: s.x, y: s.y, r: 14 }, { atMs: 0, basis })!;
      if (i.aim.kind !== 'angles') throw new Error('angles expected');
      const toGoal = Math.atan2(-ball.x, ball.z);
      expect(i.aim.azimuth).toBeCloseTo(toGoal, 9);
    }
  });
});

describe('power mapping', () => {
  it('ease-in curve with 0.3 → 40 km/h and 2.5 m/s → 115 km/h end points', () => {
    expect(powerFromFingerSpeed(FINGER_MIN_MPS)).toBe(0);
    expect(powerFromFingerSpeed(0.1)).toBe(0);
    expect(powerFromFingerSpeed(FINGER_MAX_MPS)).toBe(1);
    expect(powerFromFingerSpeed(4)).toBe(1);
    expect(speedKmhFromPower(powerFromFingerSpeed(FINGER_MIN_MPS))).toBe(40);
    expect(speedKmhFromPower(powerFromFingerSpeed(FINGER_MAX_MPS))).toBe(115);
    const mid = powerFromFingerSpeed((FINGER_MIN_MPS + FINGER_MAX_MPS) / 2);
    expect(mid).toBeGreaterThan(0.2);
    expect(mid).toBeLessThan(0.5);
    let prev = -1;
    for (let v = 0.3; v <= 2.5; v += 0.1) {
      const p = powerFromFingerSpeed(v);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });

  it('96 CSS px per inch: 1 m/s of finger speed is ≈3.78 px/ms', () => {
    expect(CSS_PX_PER_METRE).toBeCloseTo(3779.53, 1);
    const p: PointerSample[] = [
      { x: 0, y: 0, t: 0 },
      { x: 0, y: -378, t: 100 },
    ];
    expect(releaseSpeedMps(p)).toBeCloseTo(1, 2);
  });

  it('release speed uses the end of the swipe (a fast flick after a slow start counts as fast)', () => {
    const slowThenFast: PointerSample[] = [
      { x: 0, y: 0, t: 0 },
      { x: 0, y: -20, t: 400 },
      { x: 0, y: -40, t: 800 },
      { x: 0, y: -440, t: 840 },
      { x: 0, y: -840, t: 880 },
    ];
    expect(releaseSpeedMps(slowThenFast)).toBeGreaterThan(2.5);
  });
});

describe('signedCurvature', () => {
  it('is zero for a straight path and antisymmetric under mirroring', () => {
    expect(signedCurvature(path(0, 0, 0, -300, 1))).toBeCloseTo(0, 12);
    const a = signedCurvature(path(0, 0, 0, -300, 1, 30));
    const b = signedCurvature(path(0, 0, 0, -300, 1, -30));
    expect(a).toBeGreaterThan(0);
    expect(b).toBeCloseTo(-a, 12);
    // Circular-ish arc: area ≈ (2/π)·sagitta·chord for a sine bow → k ≈ (2/π)(s/L).
    expect(a).toBeCloseTo((2 / Math.PI) * (30 / 300), 2);
  });
});

describe('contact band on the ball', () => {
  it('reads top/centre/bottom over at least ±40 px with a ±10 px centre dead band', () => {
    const small = { x: 0, y: 100, r: 6 };
    expect(contactBandPx(6)).toBe(CONTACT_BAND_MIN_PX);
    expect(contactFromStart({ x: 0, y: 108 }, small)).toBe(0);
    expect(contactFromStart({ x: 0, y: 92 }, small)).toBe(0);
    expect(contactFromStart({ x: 0, y: 60 }, small)).toBe(-1);
    expect(contactFromStart({ x: 0, y: 140 }, small)).toBe(1);
    expect(contactFromStart({ x: 0, y: 75 }, small)).toBeCloseTo(-0.5, 9);
  });
  it('scales with the 2.2 r ring for big balls', () => {
    const big = { x: 0, y: 0, r: 30 };
    expect(contactBandPx(30)).toBeCloseTo(66, 9);
    expect(contactFromStart({ x: 0, y: -40 }, big)).toBe(-1 * ((40 - 10) / (66 - 10)));
    expect(contactFromStart({ x: 0, y: 66 }, big)).toBe(1);
  });
});

describe('pixel density for finger speed', () => {
  it('uses 96 CSS px/in for mouse and 150 CSS px/in for coarse (touch) pointers', () => {
    expect(CSS_PX_PER_INCH).toBe(96);
    expect(CSS_PX_PER_INCH_COARSE).toBe(150);
    expect(pxPerMetreFor(false)).toBeCloseTo(3779.53, 1);
    expect(pxPerMetreFor(true)).toBeCloseTo(5905.51, 1);
    expect(CSS_PX_PER_METRE_COARSE).toBe(pxPerMetreFor(true));
    // Same swipe on a touch screen is a slower finger in metres.
    const p: PointerSample[] = [
      { x: 0, y: 0, t: 0 },
      { x: 0, y: -590.551, t: 100 },
    ];
    expect(releaseSpeedMps(p, pxPerMetreFor(true))).toBeCloseTo(1, 3);
  });
});

describe('long-shot tap strike', () => {
  it('aims at the goal centre along the pitch with no spin and the given power', () => {
    const basis = { forward: { x: 0, y: -1 }, right: { x: 1, y: 0 }, baseAzimuth: 0.3 };
    const i = tapStrikeIntent(basis, 0.62, 1234);
    expect(i).toMatchObject({ kind: 'strike', scheme: 'swipe', power: 0.62, sideSpin: 0, topSpin: 0, atMs: 1234 });
    expect(i.aim).toMatchObject({ kind: 'angles', azimuth: 0.3 });
    expect(tapStrikeIntent(undefined, 3, 0).power).toBe(1);
  });
});
