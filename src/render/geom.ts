// Small geometry helpers: an indexed builder for flat strips and a colour-and-merge helper.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Accumulates indexed triangles; every vertex carries position, normal, uv. */
export class GeoBuilder {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly uv: number[] = [];
  readonly idx: number[] = [];

  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, u = 0, v = 0): number {
    this.pos.push(x, y, z);
    this.nrm.push(nx, ny, nz);
    this.uv.push(u, v);
    return this.pos.length / 3 - 1;
  }

  quad(a: number, b: number, c: number, d: number): void {
    // a-b-c-d counter-clockwise seen from the front.
    this.idx.push(a, b, c, a, c, d);
  }

  /** Flat quad on the ground (y fixed) along the segment (x1,z1)→(x2,z2) with width w, extended by ext at both ends. */
  groundSegment(x1: number, z1: number, x2: number, z2: number, w: number, y: number, ext = w / 2): void {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const len = Math.hypot(dx, dz) || 1;
    const tx = dx / len;
    const tz = dz / len;
    const nx = -tz * (w / 2);
    const nz = tx * (w / 2);
    const ax = x1 - tx * ext;
    const az = z1 - tz * ext;
    const bx = x2 + tx * ext;
    const bz = z2 + tz * ext;
    const v0 = this.vertex(ax + nx, y, az + nz, 0, 1, 0);
    const v1 = this.vertex(ax - nx, y, az - nz, 0, 1, 0);
    const v2 = this.vertex(bx - nx, y, bz - nz, 0, 1, 0);
    const v3 = this.vertex(bx + nx, y, bz + nz, 0, 1, 0);
    this.upQuad(v0, v1, v2, v3);
  }

  /** Ground arc of radius r around (cx,cz), angle a measured from +x towards +z. */
  groundArc(cx: number, cz: number, r: number, a0: number, a1: number, w: number, y: number, segments: number): void {
    let prevIn = -1;
    let prevOut = -1;
    for (let i = 0; i <= segments; i++) {
      const a = a0 + ((a1 - a0) * i) / segments;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const vi = this.vertex(cx + (r - w / 2) * c, y, cz + (r - w / 2) * s, 0, 1, 0);
      const vo = this.vertex(cx + (r + w / 2) * c, y, cz + (r + w / 2) * s, 0, 1, 0);
      if (i > 0) this.upQuad(prevIn, prevOut, vo, vi);
      prevIn = vi;
      prevOut = vo;
    }
  }

  groundDisc(cx: number, cz: number, r: number, y: number, segments: number): void {
    const c0 = this.vertex(cx, y, cz, 0, 1, 0);
    let prev = -1;
    for (let i = 0; i <= segments; i++) {
      const a = (2 * Math.PI * i) / segments;
      const v = this.vertex(cx + r * Math.cos(a), y, cz + r * Math.sin(a), 0, 1, 0);
      if (i > 0) this.upTri(c0, prev, v);
      prev = v;
    }
  }

  /** Adds a triangle and flips it if needed so it faces +y. */
  private upTri(a: number, b: number, c: number): void {
    if (this.normalY(a, b, c) >= 0) this.idx.push(a, b, c);
    else this.idx.push(a, c, b);
  }

  private upQuad(a: number, b: number, c: number, d: number): void {
    this.upTri(a, b, c);
    this.upTri(a, c, d);
  }

  private normalY(a: number, b: number, c: number): number {
    const p = this.pos;
    const ax = p[b * 3] - p[a * 3];
    const az = p[b * 3 + 2] - p[a * 3 + 2];
    const bx = p[c * 3] - p[a * 3];
    const bz = p[c * 3 + 2] - p[a * 3 + 2];
    return az * bx - ax * bz;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    return g;
  }
}

/** Gives a geometry a flat vertex colour and strips it to position/normal/color so different shapes merge. */
export function painted(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation): THREE.BufferGeometry {
  const g = geo;
  const n = g.getAttribute('position').count;
  const c = new THREE.Color(color);
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute('uv');
  return g;
}

/** Merges geometries that share the same attribute set (throws a descriptive error otherwise). */
export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const indexed = parts.map((p) => (p.index ? p : indexedCopy(p)));
  const merged = mergeGeometries(indexed, false);
  if (!merged) throw new Error('render: geometry merge failed (attribute mismatch)');
  for (const p of parts) p.dispose();
  return merged;
}

function indexedCopy(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = g.getAttribute('position').count;
  const idx: number[] = [];
  for (let i = 0; i < n; i++) idx.push(i);
  g.setIndex(idx);
  return g;
}

/** Cylinder between two points (for bars and supports). */
export function cylinderBetween(
  a: THREE.Vector3,
  b: THREE.Vector3,
  radius: number,
  radialSegments: number,
): THREE.BufferGeometry {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(radius, radius, len, radialSegments, 1, true);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  g.applyQuaternion(q);
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

/** Creates a 2D canvas (throws only if the DOM has no canvas support). */
export function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('render: 2D canvas unavailable');
  return { canvas, ctx };
}

/** Deterministic PRNG for procedural textures (same look every load). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
