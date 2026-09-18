// Tiny vector helpers for the sim (plain objects, no allocation tricks).
import type { Vec3 } from '../contracts';

export const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
export const ZERO: Readonly<Vec3> = Object.freeze({ x: 0, y: 0, z: 0 });
export const copy = (a: Vec3): Vec3 => ({ x: a.x, y: a.y, z: a.z });
export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const len = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
});
export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const DEG = Math.PI / 180;
export const KMH = 1 / 3.6;

/** Unit horizontal direction from `from` towards `to` (y ignored). Falls back to −z. */
export function flatDir(from: Vec3, to: Vec3): Vec3 {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const l = Math.hypot(dx, dz);
  return l > 1e-9 ? { x: dx / l, y: 0, z: dz / l } : { x: 0, y: 0, z: -1 };
}

/** Kicker's right-hand horizontal axis for a facing direction f (horizontal unit vector). */
export const rightOf = (f: Vec3): Vec3 => ({ x: -f.z, y: 0, z: f.x });
