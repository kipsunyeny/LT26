// Trails: thin tubes along a polyline, written into preallocated buffers (no allocation per update).
// Used for the flight path (sky blue), the best-kick ghost (dim white, dashed) and the aim preview.
import * as THREE from 'three';
import type { Vec3 } from '../contracts';

export const TRAIL_MAX_POINTS = 720;
export const TRAIL_RADIAL = 6;

/** Picks at most `max` points, always keeping the first and the last. */
export function downsample(points: readonly Vec3[], max: number): Vec3[] {
  if (points.length <= max) return points.slice();
  const out: Vec3[] = [];
  const step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]);
  return out;
}

/**
 * Fills `pos` with a ring of `radial` vertices per point and `idx` with triangles joining consecutive rings.
 * dash > 0 keeps alternate stretches of `dash` metres (dashed line). Returns index count.
 */
export function buildTube(
  points: readonly Vec3[],
  radius: number,
  radial: number,
  dash: number,
  pos: Float32Array,
  idx: Uint32Array,
): number {
  const n = points.length;
  if (n < 2) return 0;
  let s = 0;
  let ic = 0;
  for (let i = 0; i < n; i++) {
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
    const p = points[i];
    for (let k = 0; k < radial; k++) {
      const ang = (2 * Math.PI * k) / radial;
      const c = Math.cos(ang) * radius;
      const sn = Math.sin(ang) * radius;
      const o = (i * radial + k) * 3;
      pos[o] = p.x + n1x * c + n2x * sn;
      pos[o + 1] = p.y + n1y * c + n2y * sn;
      pos[o + 2] = p.z + n1z * c + n2z * sn;
    }
    if (i > 0) {
      const q = points[i - 1];
      const segMid = s + 0.5 * Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
      s += Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
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
  }
  return ic;
}

export class TubeLine {
  readonly mesh: THREE.Mesh;
  private readonly pos: Float32Array;
  private readonly idx: Uint32Array;
  private readonly geo: THREE.BufferGeometry;

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

  set(points: readonly Vec3[] | null): void {
    if (!points || points.length < 2) {
      this.mesh.visible = false;
      this.geo.setDrawRange(0, 0);
      return;
    }
    const pts = downsample(points, TRAIL_MAX_POINTS);
    const count = buildTube(pts, this.radius, TRAIL_RADIAL, this.dash, this.pos, this.idx);
    const pa = this.geo.getAttribute('position') as THREE.BufferAttribute;
    pa.clearUpdateRanges();
    pa.addUpdateRange(0, pts.length * TRAIL_RADIAL * 3);
    pa.needsUpdate = true;
    const ia = this.geo.getIndex() as THREE.BufferAttribute;
    ia.clearUpdateRanges();
    ia.addUpdateRange(0, count);
    ia.needsUpdate = true;
    this.geo.setDrawRange(0, count);
    this.mesh.visible = count > 0;
  }

  dispose(): void {
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
