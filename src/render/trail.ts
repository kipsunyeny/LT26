// Trails: thin tubes along a polyline, written into preallocated buffers (no allocation per update).
// Used for the flight path (sky blue), the best-kick ghost (dim white, dashed) and the aim preview.
// Growing paths are appended in place; near the camera the tube thins and then disappears so it can never
// fill the screen.
import * as THREE from 'three';
import type { Vec3 } from '../contracts';

export const TRAIL_MAX_POINTS = 720;
export const TRAIL_RADIAL = 6;
/** Inside this distance (m) from the eye the tube radius shrinks linearly with distance. */
export const TRAIL_THIN_DIST = 3;
/** Segments with an end closer than this (m) to the eye are not drawn. */
export const TRAIL_HIDE_DIST = 1.5;

/** Picks at most `max` points, always keeping the first and the last. */
export function downsample(points: readonly Vec3[], max: number): Vec3[] {
  if (points.length <= max) return points.slice();
  const out: Vec3[] = [];
  const step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]);
  return out;
}

/** Mutable build state so a tube can be extended without rebuilding its start. */
export interface TubeState {
  /** Number of points whose rings and segments are written. */
  n: number;
  /** Index count written. */
  ic: number;
  /** Cumulative path length at each point (for dashes). */
  s: Float32Array;
  /** Eye distance of each point (Infinity without an eye). */
  d: Float32Array;
  /** Smallest eye distance over the built points. */
  minDist: number;
}

export function newTubeState(maxPoints: number): TubeState {
  return { n: 0, ic: 0, s: new Float32Array(maxPoints), d: new Float32Array(maxPoints), minDist: Infinity };
}

/** Writes ring i (needs points i−1 and i+1 if present). */
function writeRing(
  points: readonly Vec3[],
  n: number,
  i: number,
  radius: number,
  radial: number,
  dist: number,
  pos: Float32Array,
): void {
  const a = points[Math.max(0, i - 1)];
  const b = points[Math.min(n - 1, i + 1)];
  let tx = b.x - a.x;
  let ty = b.y - a.y;
  let tz = b.z - a.z;
  const tl = Math.hypot(tx, ty, tz) || 1;
  tx /= tl;
  ty /= tl;
  tz /= tl;
  // n1 = t × up (horizontal side vector); fall back to t × x for vertical tangents.
  let n1x = -tz;
  let n1y = 0;
  let n1z = tx;
  let l1 = Math.hypot(n1x, n1z);
  if (l1 < 1e-3) {
    n1x = 0;
    n1y = tz;
    n1z = -ty;
    l1 = Math.hypot(n1y, n1z) || 1;
  }
  n1x /= l1;
  n1y /= l1;
  n1z /= l1;
  // n2 = n1 × t.
  const n2x = n1y * tz - n1z * ty;
  const n2y = n1z * tx - n1x * tz;
  const n2z = n1x * ty - n1y * tx;
  const r = radius * Math.min(1, dist / TRAIL_THIN_DIST);
  const p = points[i];
  for (let k = 0; k < radial; k++) {
    const ang = (2 * Math.PI * k) / radial;
    const c = Math.cos(ang) * r;
    const sn = Math.sin(ang) * r;
    const o = (i * radial + k) * 3;
    pos[o] = p.x + n1x * c + n2x * sn;
    pos[o + 1] = p.y + n1y * c + n2y * sn;
    pos[o + 2] = p.z + n1z * c + n2z * sn;
  }
}

/**
 * Extends a tube built for points[0 .. st.n−1] to points[0 .. n−1] (n ≤ capacity), or builds it from scratch
 * when st.n = 0. Ring st.n−1 is rewritten because its tangent changes. dash > 0 keeps alternate stretches of
 * `dash` metres. eye (optional) thins/hides the tube near the camera. Returns the index count.
 */
export function extendTube(
  points: readonly Vec3[],
  n: number,
  radius: number,
  radial: number,
  dash: number,
  eye: Vec3 | null,
  pos: Float32Array,
  idx: Uint32Array,
  st: TubeState,
): number {
  if (n < 2) {
    st.n = 0;
    st.ic = 0;
    st.minDist = Infinity;
    return 0;
  }
  const from = Math.max(0, st.n - 1);
  for (let i = st.n; i < n; i++) {
    const p = points[i];
    st.d[i] = eye ? Math.hypot(p.x - eye.x, p.y - eye.y, p.z - eye.z) : Infinity;
    st.minDist = Math.min(st.minDist, st.d[i]);
    if (i === 0) st.s[0] = 0;
    else {
      const q = points[i - 1];
      st.s[i] = st.s[i - 1] + Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
    }
  }
  for (let i = from; i < n; i++) writeRing(points, n, i, radius, radial, st.d[i], pos);
  let ic = st.ic;
  for (let i = Math.max(1, st.n); i < n; i++) {
    if (st.d[i - 1] < TRAIL_HIDE_DIST || st.d[i] < TRAIL_HIDE_DIST) continue;
    const segMid = (st.s[i - 1] + st.s[i]) / 2;
    if (dash > 0 && Math.floor(segMid / dash) % 2 === 1) continue;
    const r0 = (i - 1) * radial;
    const r1 = i * radial;
    for (let k = 0; k < radial; k++) {
      const k1 = (k + 1) % radial;
      idx[ic++] = r0 + k;
      idx[ic++] = r1 + k;
      idx[ic++] = r1 + k1;
      idx[ic++] = r0 + k;
      idx[ic++] = r1 + k1;
      idx[ic++] = r0 + k1;
    }
  }
  st.n = n;
  st.ic = ic;
  return ic;
}

/** Builds a whole tube (see extendTube). Returns the index count. */
export function buildTube(
  points: readonly Vec3[],
  radius: number,
  radial: number,
  dash: number,
  pos: Float32Array,
  idx: Uint32Array,
  eye: Vec3 | null = null,
): number {
  return extendTube(points, points.length, radius, radial, dash, eye, pos, idx, newTubeState(points.length));
}

const samePoint = (a: Vec3, b: Vec3) => a.x === b.x && a.y === b.y && a.z === b.z;

export type TubeUpdate = 'unchanged' | 'appended' | 'rebuilt' | 'cleared';

export class TubeLine {
  readonly mesh: THREE.Mesh;
  private readonly pos: Float32Array;
  private readonly idx: Uint32Array;
  private readonly geo: THREE.BufferGeometry;
  private readonly st = newTubeState(TRAIL_MAX_POINTS);
  /** Last source array, its length and a copy of its first and last points (to detect in-place growth). */
  private src: readonly Vec3[] | null = null;
  private srcLen = 0;
  private readonly first: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly lastPt: Vec3 = { x: 0, y: 0, z: 0 };
  /** Points actually built (the source or a downsampled copy). */
  private built: readonly Vec3[] = [];
  private readonly eye: Vec3 = { x: 0, y: 0, z: 1e9 };
  private readonly builtEye: Vec3 = { x: 0, y: 0, z: 1e9 };

  constructor(
    color: number,
    opacity: number,
    private readonly radius: number,
    private readonly dash: number,
  ) {
    this.pos = new Float32Array(TRAIL_MAX_POINTS * TRAIL_RADIAL * 3);
    this.idx = new Uint32Array((TRAIL_MAX_POINTS - 1) * TRAIL_RADIAL * 6);
    this.geo = new THREE.BufferGeometry();
    const pa = new THREE.BufferAttribute(this.pos, 3);
    pa.setUsage(THREE.DynamicDrawUsage);
    const ia = new THREE.BufferAttribute(this.idx, 1);
    ia.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', pa);
    this.geo.setIndex(ia);
    this.geo.setDrawRange(0, 0);
    const transparent = opacity < 1;
    this.mesh = new THREE.Mesh(
      this.geo,
      new THREE.MeshBasicMaterial({ color, transparent, opacity, depthWrite: !transparent }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /** Draw-range size (0 = nothing drawn). */
  get indexCount(): number {
    return this.geo.drawRange.count;
  }

  /**
   * Sets the polyline. The same array (or a new one with the same first/last-known points) that only grew is
   * appended in place; an identical one is a no-op.
   */
  set(points: readonly Vec3[] | null): TubeUpdate {
    if (!points || points.length < 2) {
      const had = this.src !== null;
      this.src = null;
      this.srcLen = 0;
      this.built = [];
      this.st.n = 0;
      this.st.ic = 0;
      this.st.minDist = Infinity;
      this.geo.setDrawRange(0, 0);
      this.mesh.visible = false;
      return had ? 'cleared' : 'unchanged';
    }
    const n = points.length;
    const prefixSame =
      this.src !== null &&
      n >= this.srcLen &&
      samePoint(points[0], this.first) &&
      samePoint(points[this.srcLen - 1], this.lastPt);
    if (prefixSame && n === this.srcLen) return 'unchanged';
    let result: TubeUpdate;
    if (prefixSame && n <= TRAIL_MAX_POINTS && this.built === this.src) {
      this.built = points;
      this.write(this.st.n);
      result = 'appended';
    } else {
      this.built = n <= TRAIL_MAX_POINTS ? points : downsample(points, TRAIL_MAX_POINTS);
      this.st.n = 0;
      this.st.ic = 0;
      this.st.minDist = Infinity;
      this.write(0);
      result = 'rebuilt';
    }
    this.src = points;
    this.srcLen = n;
    this.first.x = points[0].x;
    this.first.y = points[0].y;
    this.first.z = points[0].z;
    this.lastPt.x = points[n - 1].x;
    this.lastPt.y = points[n - 1].y;
    this.lastPt.z = points[n - 1].z;
    return result;
  }

  /**
   * Tells the tube where the camera is. Rebuilds only if the move can change the near-camera thinning,
   * i.e. when some point is (or could now be) within TRAIL_THIN_DIST.
   */
  setEye(x: number, y: number, z: number): void {
    this.eye.x = x;
    this.eye.y = y;
    this.eye.z = z;
    if (this.st.n < 2) return;
    const move = Math.hypot(x - this.builtEye.x, y - this.builtEye.y, z - this.builtEye.z);
    if (move < 0.05 || this.st.minDist - move > TRAIL_THIN_DIST) return;
    this.st.n = 0;
    this.st.ic = 0;
    this.st.minDist = Infinity;
    this.write(0);
  }

  private write(fromPoint: number): void {
    const pts = this.built;
    this.builtEye.x = this.eye.x;
    this.builtEye.y = this.eye.y;
    this.builtEye.z = this.eye.z;
    const icBefore = this.st.ic;
    const count = extendTube(
      pts,
      pts.length,
      this.radius,
      TRAIL_RADIAL,
      this.dash,
      this.eye,
      this.pos,
      this.idx,
      this.st,
    );
    const pa = this.geo.getAttribute('position') as THREE.BufferAttribute;
    const ringFrom = Math.max(0, fromPoint - 1);
    pa.clearUpdateRanges();
    pa.addUpdateRange(ringFrom * TRAIL_RADIAL * 3, (pts.length - ringFrom) * TRAIL_RADIAL * 3);
    pa.needsUpdate = true;
    const ia = this.geo.getIndex() as THREE.BufferAttribute;
    ia.clearUpdateRanges();
    const idxFrom = fromPoint > 0 ? icBefore : 0;
    if (count > idxFrom) {
      ia.addUpdateRange(idxFrom, count - idxFrom);
      ia.needsUpdate = true;
    }
    this.geo.setDrawRange(0, count);
    this.mesh.visible = count > 0;
  }

  dispose(): void {
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
