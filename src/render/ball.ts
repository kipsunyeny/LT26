// Ball: white sphere with navy pentagon panels (truncated-icosahedron pattern painted on an equirect canvas),
// rotated by integrating the world spin vector over time.
import * as THREE from 'three';
import type { Vec3 } from '../contracts';
import { makeCanvas } from './geom';

export const BALL_RADIUS = 0.11;
const NAVY = [0x00, 0x0e, 0x29];
const WHITE = [0xf5, 0xf7, 0xfa];
const SEAM = [0x8a, 0x93, 0x9e];
/** Hexagon / pentagon face distance ratio of a truncated icosahedron (2.2672 / 2.3279). */
const PENT_SCALE = 0.97392;

/** Panel centres of a truncated icosahedron: 12 pentagons (icosahedron vertices) and 20 hexagons. */
export function panelCentres(): { pent: number[][]; hex: number[][] } {
  const phi = (1 + Math.sqrt(5)) / 2;
  const norm = (v: number[]) => {
    const l = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const pent: number[][] = [];
  for (const a of [-1, 1])
    for (const b of [-phi, phi]) {
      pent.push(norm([0, a, b]), norm([a, b, 0]), norm([b, 0, a]));
    }
  const hex: number[][] = [];
  for (const a of [-1, 1]) for (const b of [-1, 1]) for (const c of [-1, 1]) hex.push(norm([a, b, c]));
  const ip = 1 / phi;
  for (const a of [-ip, ip])
    for (const b of [-phi, phi]) {
      // Cyclic permutations of (0, ±φ, ±1/φ): the dodecahedron dual to the icosahedron above.
      hex.push(norm([0, b, a]), norm([b, a, 0]), norm([a, 0, b]));
    }
  return { pent, hex };
}

function ballTexture(): THREE.CanvasTexture {
  const W = 512;
  const H = 256;
  const { canvas, ctx } = makeCanvas(W, H);
  const img = ctx.createImageData(W, H);
  const { pent, hex } = panelCentres();
  const all = [...pent, ...hex];
  for (let j = 0; j < H; j++) {
    const theta = ((j + 0.5) / H) * Math.PI;
    const st = Math.sin(theta);
    const y = Math.cos(theta);
    for (let i = 0; i < W; i++) {
      const ph = ((i + 0.5) / W) * Math.PI * 2;
      // Same parametrisation as THREE.SphereGeometry (u = phi / 2π, v = 1 − theta / π, canvas flipped).
      const x = -Math.cos(ph) * st;
      const z = Math.sin(ph) * st;
      let best = -2;
      let second = -2;
      let bestIdx = 0;
      for (let k = 0; k < all.length; k++) {
        const c = all[k];
        // Radial projection of the polyhedron faces: compare dot / face-distance (pentagons sit farther out).
        const d = (c[0] * x + c[1] * y + c[2] * z) * (k < pent.length ? PENT_SCALE : 1);
        if (d > best) {
          second = best;
          best = d;
          bestIdx = k;
        } else if (d > second) second = d;
      }
      const col = best - second < 0.012 ? SEAM : bestIdx < pent.length ? NAVY : WHITE;
      const o = (j * W + i) * 4;
      img.data[o] = col[0];
      img.data[o + 1] = col[1];
      img.data[o + 2] = col[2];
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class BallView {
  readonly mesh: THREE.Mesh;
  private readonly q = new THREE.Quaternion();
  private readonly axis = new THREE.Vector3();

  constructor() {
    const g = new THREE.SphereGeometry(BALL_RADIUS, 28, 18);
    const m = new THREE.MeshLambertMaterial({ map: ballTexture(), emissive: 0x1a1a1a });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.name = 'ball';
  }

  /** Moves the ball and rotates it by |w|·dt about w (world frame). */
  update(p: Vec3, w: Vec3, dt: number): void {
    this.mesh.position.set(p.x, p.y, p.z);
    const rate = Math.hypot(w.x, w.y, w.z);
    if (rate > 1e-4 && dt > 0) {
      this.axis.set(w.x / rate, w.y / rate, w.z / rate);
      this.q.setFromAxisAngle(this.axis, rate * dt);
      this.mesh.quaternion.premultiply(this.q);
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    const m = this.mesh.material as THREE.MeshLambertMaterial;
    m.map?.dispose();
    m.dispose();
  }
}
