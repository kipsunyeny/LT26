import { describe, expect, it } from 'vitest';
import { SPOTS, defaultSpot, freeKickSpot } from '../../src/data/presets';

const dist = (b: { x: number; z: number }): number => Math.hypot(b.x, b.z);

describe('presets', () => {
  it('required keys exist with sensible distances', () => {
    expect(SPOTS.freeKick.map((s) => s.key)).toEqual([
      'fk-centre',
      'fk-left-d',
      'fk-right-d',
      'fk-wide-left',
      'fk-wide-right',
    ]);
    expect(SPOTS.penalty.map((s) => s.key)).toEqual(['pk-spot']);
    expect(SPOTS.longShot.map((s) => s.key)).toEqual(['ls-centre', 'ls-left', 'ls-right']);
    expect(defaultSpot('freeKick').ball).toEqual({ x: 0, y: 0.11, z: 22 });
    expect(defaultSpot('penalty').ball).toEqual({ x: 0, y: 0.11, z: 11 });
    for (const s of SPOTS.freeKick) {
      expect(dist(s.ball)).toBeGreaterThanOrEqual(16);
      expect(dist(s.ball)).toBeLessThanOrEqual(35);
      expect(s.ball.z > 16.5 || Math.abs(s.ball.x) > 20.16).toBe(true);
    }
    for (const s of SPOTS.longShot) {
      expect(dist(s.ball)).toBeGreaterThanOrEqual(20);
      expect(dist(s.ball)).toBeLessThanOrEqual(30);
    }
    for (const list of Object.values(SPOTS)) for (const s of list) expect(s.ball.y).toBe(0.11);
  });

  it('free placement: whole metres, 16–35 m, outside the box, stable key', () => {
    for (let i = 0; i < 400; i++) {
      const req = { x: Math.sin(i * 1.7) * 40, z: Math.abs(Math.cos(i * 0.9)) * 45 };
      const s = freeKickSpot(req);
      expect(Number.isInteger(s.ball.x) && Number.isInteger(s.ball.z)).toBe(true);
      expect(dist(s.ball)).toBeGreaterThanOrEqual(16);
      expect(dist(s.ball)).toBeLessThanOrEqual(35);
      expect(s.ball.z > 16.5 || Math.abs(s.ball.x) > 20.16).toBe(true);
      expect(s.key).toBe(`fk-x${s.ball.x}-z${s.ball.z}`);
      expect(freeKickSpot({ x: s.ball.x, z: s.ball.z })).toEqual(s);
    }
    expect(freeKickSpot({ x: -0.3, z: 25 }).key).toBe('fk-x0-z25');
    expect(freeKickSpot({ x: NaN, z: NaN }).key).toBe('fk-x0-z22');
  });
});
