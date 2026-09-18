import { describe, expect, it } from 'vitest';
import { SPOTS } from '../../src/data/presets';
import {
  DEFENDER_HEIGHT,
  DEFENDER_RADIUS,
  WALL_DISTANCE,
  layoutWall,
  wallColliders,
  wallCount,
  wallJumpHeight,
} from '../../src/sim/wall';
import { v3 } from '../../src/sim/vec';
import { newSim, runToResult, strike } from './sim.helpers';

describe('wall layout', () => {
  it('3–5 defenders: more when closer and more central', () => {
    expect(wallCount(v3(0, 0.11, 22))).toBe(5);
    expect(wallCount(v3(0, 0.11, 30))).toBe(4);
    expect(wallCount(v3(0, 0.11, 35))).toBe(3);
    expect(wallCount(v3(-15, 0.11, 18.5))).toBe(4);
    expect(wallCount(v3(-25, 0.11, 20))).toBe(3);
    for (const s of SPOTS.freeKick) {
      const n = layoutWall(s.ball).feet.length;
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(5);
    }
  });

  it('stands 9.15 m from the ball, shoulder to shoulder, the outside man on the ball→near-post line', () => {
    for (const s of SPOTS.freeKick) {
      const b = s.ball;
      const w = layoutWall(b);
      const post = v3(w.nearSide * 3.72, 0, 0);
      const f = { x: post.x - b.x, z: post.z - b.z };
      const fl = Math.hypot(f.x, f.z);
      // Distance of the wall line from the ball = 9.15 m; nobody closer.
      for (const p of w.feet) {
        const along = ((p.x - b.x) * f.x + (p.z - b.z) * f.z) / fl;
        expect(along).toBeCloseTo(WALL_DISTANCE, 9);
        expect(Math.hypot(p.x - b.x, p.z - b.z)).toBeGreaterThanOrEqual(WALL_DISTANCE - 1e-9);
      }
      // Outside man on the ball→post line.
      const o = w.feet[0];
      const cross = ((o.x - b.x) * f.z - (o.z - b.z) * f.x) / fl;
      expect(Math.abs(cross)).toBeLessThan(1e-9);
      // 0.5 m spacing, extending towards the goal centre side.
      for (let i = 1; i < w.feet.length; i++) {
        expect(Math.hypot(w.feet[i].x - w.feet[i - 1].x, w.feet[i].z - w.feet[i - 1].z)).toBeCloseTo(0.5, 9);
      }
      expect(Math.sign(w.feet[w.feet.length - 1].x - o.x)).toBe(-w.nearSide);
    }
    expect(layoutWall(v3(-6, 0.11, 18.5)).nearSide).toBe(-1);
    expect(layoutWall(v3(6, 0.11, 18.5)).nearSide).toBe(1);
  });

  it('capsules 1.85 m tall, radius 0.22, raised by the jump', () => {
    const w = layoutWall(v3(0, 0.11, 22));
    const [c] = wallColliders(w, 0.3);
    expect(c.kind).toBe('capsule');
    if (c.kind !== 'capsule') return;
    expect(c.radius).toBe(DEFENDER_RADIUS);
    expect(c.b.y + c.radius).toBeCloseTo(DEFENDER_HEIGHT + 0.3, 9);
    expect(c.a.y - c.radius).toBeCloseTo(0.3, 9);
  });

  it('jump: nothing for 0.15 s, then a ballistic 0.4 m jump', () => {
    expect(wallJumpHeight(null)).toBe(0);
    expect(wallJumpHeight(0.149)).toBe(0);
    let peak = 0;
    let peakT = 0;
    for (let t = 0; t < 1.2; t += 0.001) {
      const h = wallJumpHeight(t);
      if (h > peak) {
        peak = h;
        peakT = t;
      }
    }
    expect(peak).toBeCloseTo(0.4, 3);
    expect(peakT).toBeCloseTo(0.15 + Math.sqrt((2 * 0.4) / 9.81), 2);
    expect(wallJumpHeight(1.0)).toBe(0);
  });

  it('in play: wallJump event 0.15 s after the kick and the recorded wall rises to ≈0.4 m', () => {
    const { sim, events } = newSim(3);
    sim.setMode('freeKick');
    sim.applyIntent(strike({ kind: 'target', x: 2.5, y: 1.5 }, 0.6, 0, 0));
    runToResult(sim);
    const kick = events.find((e) => e.type === 'kick');
    const jump = events.find((e) => e.type === 'wallJump');
    expect(kick && jump).toBeTruthy();
    if (!kick || !jump) return;
    expect(jump.t - kick.t).toBeGreaterThanOrEqual(0.15 - 1e-9);
    expect(jump.t - kick.t).toBeLessThan(0.15 + 1 / 240 + 1e-9);
    const frames = sim.state.lastRecording?.frames ?? [];
    expect(frames[0].wall.length).toBe(5);
    const maxJump = Math.max(...frames.map((f) => f.wall[0].jump));
    expect(maxJump).toBeGreaterThan(0.38);
    expect(maxJump).toBeLessThanOrEqual(0.4 + 1e-9);
  });
});
