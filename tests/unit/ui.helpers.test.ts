import { describe, expect, it } from 'vitest';
import type { ShotSummary, SpotStats } from '../../src/contracts';
import { clampDt } from '../../src/ui/app';
import { FK_MAX_DIST, FK_MIN_DIST, minimapFromScreen, minimapPlace, MM_VIEW } from '../../src/ui/minimap';
import { createFallbackProjector } from '../../src/ui/projector';
import { replayFrameIndex, sideView } from '../../src/ui/replay';
import { crossingLabel, resultLabel, shotCardRows } from '../../src/ui/shotCard';
import { spotLabel } from '../../src/ui/spots';
import { statsRows } from '../../src/ui/stats';

const summary = (over: Partial<ShotSummary> = {}): ShotSummary => ({
  mode: 'freeKick',
  spotKey: 'fk-centre',
  result: 'miss',
  speedKmh: 98.4,
  spinRps: 8.04,
  lateralCurveM: 2.614,
  apexM: 2.9,
  timeToGoalS: 1.08,
  crossing: { x: 3.9, y: 1.2 },
  missDistanceM: 0.18,
  path: [],
  ...over,
});

describe('shot card', () => {
  it('lists every metric of §1.2 with units', () => {
    const rows = shotCardRows(summary(), -35);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.value]));
    expect(byId).toMatchObject({
      speed: '98 km/h',
      spin: '8.0 rev/s',
      curve: '2.61 m',
      apex: '2.90 m',
      time: '1.08 s',
      crossing: '3.90 m right, 1.20 m high',
      miss: '0.18 m',
      timing: '−35 ms · perfect',
    });
    const goal = shotCardRows(summary({ result: 'goal' }), null).map((r) => r.id);
    expect(goal).not.toContain('miss');
    expect(goal).not.toContain('timing');
  });
  it('labels results and missing crossings', () => {
    expect(resultLabel('goal')).toBe('Goal!');
    expect(resultLabel('wall')).toMatch(/wall/);
    expect(crossingLabel(summary({ crossing: null }))).toMatch(/not reach/);
    expect(crossingLabel(summary({ crossing: { x: -1.5, y: 0.4 } }))).toBe('1.50 m left, 0.40 m high');
  });
});

describe('stats rows', () => {
  const s = (spotKey: string, mode: SpotStats['mode'], attempts: number, goals: number, avgMissM = 0.5): SpotStats => ({
    spotKey,
    mode,
    attempts,
    goals,
    avgMissM,
    best: null,
  });
  it('orders by mode and preset, computes %, hides empty spots', () => {
    const rows = statsRows([
      s('pk-spot', 'penalty', 10, 7),
      s('fk-x3-z24', 'freeKick', 2, 0, 1.234),
      s('fk-left-d', 'freeKick', 4, 1),
      s('fk-centre', 'freeKick', 5, 5),
      s('ls-left', 'longShot', 0, 0),
    ]);
    expect(rows.map((r) => r.key)).toEqual(['fk-centre', 'fk-left-d', 'fk-x3-z24', 'pk-spot']);
    expect(rows[0]).toMatchObject({ pct: '100 %', avgMiss: '–', spot: 'Centre of the D' });
    expect(rows[2]).toMatchObject({ pct: '0 %', avgMiss: '1.23 m', spot: 'Free kick 24 m out, 3 m right' });
    expect(rows[3]).toMatchObject({ pct: '70 %', mode: 'Penalty' });
  });
  it('labels free placements', () => {
    expect(spotLabel('fk-x-5-z20')).toBe('Free kick 20 m out, 5 m left');
    expect(spotLabel('fk-x0-z30')).toBe('Free kick 30 m out, centre');
    expect(spotLabel('unknown')).toBe('unknown');
  });
});

describe('mini-map placement', () => {
  it('clamps to 16–35 m from goal and rounds to the metre', () => {
    for (const [x, z] of [
      [0, 5],
      [0, 50],
      [3, 20],
      [-30, 30],
      [21, 3],
      [0.4, 16.2],
    ]) {
      const p = minimapPlace(x, z);
      const d = Math.hypot(p.x, p.z);
      expect(d).toBeGreaterThanOrEqual(FK_MIN_DIST - 0.01);
      expect(d).toBeLessThanOrEqual(FK_MAX_DIST + 0.01);
      expect(Number.isInteger(p.x) && Number.isInteger(p.z)).toBe(true);
      expect(p.z).toBeGreaterThanOrEqual(2);
    }
    expect(minimapPlace(3, 20)).toEqual({ x: 3, z: 20 });
    expect(minimapPlace(0, 5)).toEqual({ x: 0, z: 16 });
  });
  it('maps screen to metres with letterboxing', () => {
    const box = { left: 100, top: 50, width: 220, height: 200 }; // 44×40 m at 5 px/m
    expect(minimapFromScreen(100, 50, box)).toEqual({ x: MM_VIEW.x, z: MM_VIEW.z });
    const c = minimapFromScreen(210, 150, box);
    expect(c.x).toBeCloseTo(0, 9);
    expect(c.z).toBeCloseTo(18, 9);
    const wide = minimapFromScreen(210, 150, { left: 0, top: 50, width: 420, height: 200 });
    expect(wide.x).toBeCloseTo(0, 9);
  });
});

describe('replay', () => {
  it('plays 60 Hz frames at 0.35× and holds the last frame', () => {
    expect(replayFrameIndex(0, 100)).toBe(0);
    expect(replayFrameIndex(1, 100)).toBe(21);
    expect(replayFrameIndex(100, 100)).toBe(99);
    expect(replayFrameIndex(1, 0)).toBe(-1);
  });
  it('side view puts the kick on the left and the goal on the right', () => {
    const v = sideView(
      [
        { x: 0, y: 0.11, z: 22 },
        { x: 0, y: 2, z: 11 },
        { x: 0, y: 1, z: 0 },
      ],
      240,
      80,
    );
    const pts = v.points.split(' ').map((p) => p.split(',').map(Number));
    expect(pts[0][0]).toBe(0);
    expect(pts[2][0]).toBeCloseTo(v.goalX, 1);
    expect(v.goalTop).toBeGreaterThan(0);
  });
});

describe('fallback projection (no WebGL)', () => {
  const ball = { x: 0, y: 0.11, z: 22 };
  const p = createFallbackProjector(ball, 1280, 800);
  it('puts the ball bottom-centre and the goal face in the upper middle', () => {
    const b = p.worldToScreen(ball);
    expect(b.visible).toBe(true);
    expect(b.x).toBeCloseTo(640, 6);
    expect(b.y).toBeGreaterThan(560);
    const bar = p.worldToScreen({ x: 0, y: 2.44, z: 0 });
    expect(bar.y).toBeLessThan(400);
    expect(bar.y).toBeGreaterThan(100);
    expect(p.radiusAt(ball)).toBeGreaterThan(5);
  });
  it('screenToGoalPlane inverts worldToScreen on the goal plane', () => {
    for (const t of [
      { x: 0, y: 1 },
      { x: 3.5, y: 2.2 },
      { x: -6, y: 0.3 },
    ]) {
      const s = p.worldToScreen({ ...t, z: 0 });
      const g = p.screenToGoalPlane(s.x, s.y)!;
      expect(g.x).toBeCloseTo(t.x, 6);
      expect(g.y).toBeCloseTo(t.y, 6);
    }
  });
});

describe('frame loop', () => {
  it('clamps dt to 0..0.1 s', () => {
    expect(clampDt(16)).toBeCloseTo(0.016, 9);
    expect(clampDt(5000)).toBe(0.1);
    expect(clampDt(-3)).toBe(0);
    expect(clampDt(NaN)).toBe(0);
  });
});
