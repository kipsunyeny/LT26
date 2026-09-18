import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../src/contracts';
import { buildTube, downsample, extendTube, newTubeState, TRAIL_HIDE_DIST, TRAIL_RADIAL } from '../../src/render/trail';
import { panelCentres } from '../../src/render/ball';

function line(n: number, len: number): Vec3[] {
  const pts: Vec3[] = [];
  for (let i = 0; i < n; i++) pts.push({ x: 0, y: 1, z: -(len * i) / (n - 1) });
  return pts;
}

describe('render trail tube', () => {
  it('puts every ring vertex at the tube radius around its point', () => {
    const pts: Vec3[] = [
      { x: 0, y: 0.11, z: 20 },
      { x: 0.5, y: 1.5, z: 12 },
      { x: 1, y: 2, z: 5 },
      { x: 1, y: 1.0, z: 0 },
      { x: 1, y: 0.2, z: 0 }, // vertical segment (ball dropping in the net)
    ];
    const pos = new Float32Array(pts.length * TRAIL_RADIAL * 3);
    const idx = new Uint32Array((pts.length - 1) * TRAIL_RADIAL * 6);
    const count = buildTube(pts, 0.05, TRAIL_RADIAL, 0, pos, idx);
    expect(count).toBe((pts.length - 1) * TRAIL_RADIAL * 6);
    for (let i = 0; i < pts.length; i++) {
      for (let k = 0; k < TRAIL_RADIAL; k++) {
        const o = (i * TRAIL_RADIAL + k) * 3;
        const d = Math.hypot(pos[o] - pts[i].x, pos[o + 1] - pts[i].y, pos[o + 2] - pts[i].z);
        expect(d).toBeCloseTo(0.05, 5);
      }
    }
    for (let i = 0; i < count; i++) expect(idx[i]).toBeLessThan(pts.length * TRAIL_RADIAL);
  });

  it('dashing drops about half of the segments', () => {
    const pts = line(101, 20);
    const pos = new Float32Array(pts.length * TRAIL_RADIAL * 3);
    const idx = new Uint32Array((pts.length - 1) * TRAIL_RADIAL * 6);
    const full = buildTube(pts, 0.03, TRAIL_RADIAL, 0, pos, idx);
    const dashed = buildTube(pts, 0.03, TRAIL_RADIAL, 1, pos, idx);
    expect(dashed / full).toBeGreaterThan(0.4);
    expect(dashed / full).toBeLessThan(0.6);
  });

  it('returns nothing for fewer than two points', () => {
    expect(buildTube([{ x: 0, y: 0, z: 0 }], 0.05, 6, 0, new Float32Array(18), new Uint32Array(36))).toBe(0);
  });

  it('downsample keeps first and last points and respects the cap', () => {
    const pts = line(1000, 30);
    const d = downsample(pts, 100);
    expect(d).toHaveLength(100);
    expect(d[0]).toBe(pts[0]);
    expect(d[99]).toBe(pts[999]);
  });
});

describe('render trail tube near the camera and incremental growth', () => {
  it('thins near the eye and drops segments within the hide distance', () => {
    const pts = line(41, 8); // z from 0 to -8 at y = 1
    const eye = { x: 0, y: 1.2, z: 0.5 };
    const pos = new Float32Array(pts.length * TRAIL_RADIAL * 3);
    const idx = new Uint32Array((pts.length - 1) * TRAIL_RADIAL * 6);
    const full = buildTube(pts, 0.05, TRAIL_RADIAL, 0, pos, idx);
    const near = buildTube(pts, 0.05, TRAIL_RADIAL, 0, pos, idx, eye);
    expect(near).toBeLessThan(full);
    // No drawn vertex belongs to a point closer than the hide distance.
    for (let i = 0; i < near; i++) {
      const p = pts[Math.floor(idx[i] / TRAIL_RADIAL)];
      expect(Math.hypot(p.x - eye.x, p.y - eye.y, p.z - eye.z)).toBeGreaterThanOrEqual(TRAIL_HIDE_DIST);
    }
    // Ring radius at 2 m is 2/3 of the full radius; far away it is full.
    const ringR = (i: number) =>
      Math.hypot(
        pos[i * TRAIL_RADIAL * 3] - pts[i].x,
        pos[i * TRAIL_RADIAL * 3 + 1] - pts[i].y,
        pos[i * TRAIL_RADIAL * 3 + 2] - pts[i].z,
      );
    const at2 = pts.findIndex((p) => Math.hypot(p.x - eye.x, p.y - eye.y, p.z - eye.z) >= 2);
    const d2 = Math.hypot(pts[at2].x - eye.x, pts[at2].y - eye.y, pts[at2].z - eye.z);
    expect(ringR(at2)).toBeCloseTo((0.05 * d2) / 3, 5);
    expect(ringR(40)).toBeCloseTo(0.05, 5);
  });

  it('appending points gives the same buffers as a full rebuild', () => {
    const pts: Vec3[] = [];
    for (let i = 0; i < 80; i++) pts.push({ x: Math.sin(i / 9), y: 0.11 + i * 0.03, z: 20 - i * 0.25 });
    const n = pts.length;
    const posA = new Float32Array(n * TRAIL_RADIAL * 3);
    const idxA = new Uint32Array((n - 1) * TRAIL_RADIAL * 6);
    const st = newTubeState(n);
    for (let k = 2; k < n; k += 7) extendTube(pts, k, 0.04, TRAIL_RADIAL, 0.6, null, posA, idxA, st);
    const count = extendTube(pts, n, 0.04, TRAIL_RADIAL, 0.6, null, posA, idxA, st);
    const posB = new Float32Array(n * TRAIL_RADIAL * 3);
    const idxB = new Uint32Array((n - 1) * TRAIL_RADIAL * 6);
    const countB = buildTube(pts, 0.04, TRAIL_RADIAL, 0.6, posB, idxB);
    expect(count).toBe(countB);
    for (let i = 0; i < posB.length; i++) expect(posA[i]).toBeCloseTo(posB[i], 5);
    for (let i = 0; i < countB; i++) expect(idxA[i]).toBe(idxB[i]);
  });
});

describe('render ball panels', () => {
  it('has 12 pentagon and 20 hexagon unit centres', () => {
    const { pent, hex } = panelCentres();
    expect(pent).toHaveLength(12);
    expect(hex).toHaveLength(20);
    for (const c of [...pent, ...hex]) expect(Math.hypot(c[0], c[1], c[2])).toBeCloseTo(1, 9);
    // Each pentagon centre has 5 hexagon neighbours at the same (closest) angular distance.
    const dots = hex.map((h) => h[0] * pent[0][0] + h[1] * pent[0][1] + h[2] * pent[0][2]).sort((a, b) => b - a);
    for (let i = 1; i < 5; i++) expect(dots[i]).toBeCloseTo(dots[0], 9);
    expect(dots[5]).toBeLessThan(dots[0] - 0.05);
  });
});
