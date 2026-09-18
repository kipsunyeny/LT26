import type { Vec3 } from '../contracts';
import { KNUCKLE_MAX_ACCEL, KNUCKLE_MAX_SPIN, KNUCKLE_MIN_SPEED, KNUCKLE_NOISE_HZ } from './constants';

/** Mulberry32: tiny, fast, deterministic 32-bit PRNG. Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal sample (Box–Muller) from a uniform [0, 1) generator. */
export function gaussian(rng: () => number): number {
  const u1 = 1 - rng(); // (0, 1]
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Lateral "knuckle" acceleration source. sample() returns a world-frame acceleration (m/s², at sea-level
 * density; physics scales it by ρ/RHO_SEA and removes its component along v). Zero unless the ball is
 * nearly spinless (|ω| < KNUCKLE_MAX_SPIN) and faster than KNUCKLE_MIN_SPEED.
 */
export interface KnuckleNoise {
  sample(t: number, speed: number, spin: number): Vec3;
}

/** Hash of an integer lattice index + channel into [-1, 1], deterministic per seed. */
function latticeValue(seed: number, i: number, channel: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(i, 0xc2b2ae35) ^ Math.imul(channel + 1, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967295) * 2 - 1;
}

/** Quintic fade 6u⁵ − 15u⁴ + 10u³ (C² continuous, as in improved Perlin noise). */
function fade(u: number): number {
  return u * u * u * (u * (u * 6 - 15) + 10);
}

/**
 * Smooth value noise on a 60 Hz lattice, one independent channel per horizontal/vertical axis.
 * Each lattice value is uniform in [-1, 1]; interpolation with the quintic fade keeps the sample inside
 * the hull of its two lattice values, so each channel is in [-1, 1]. The 2-vector (x, y) is scaled by
 * KNUCKLE_MAX_ACCEL and clamped to that magnitude, so |a| ≤ 0.25 m/s² always.
 */
export function createKnuckleNoise(seed: number): KnuckleNoise {
  const s = seed | 0;
  const channel = (t: number, c: number): number => {
    const x = t * KNUCKLE_NOISE_HZ;
    const i = Math.floor(x);
    const f = fade(x - i);
    const a = latticeValue(s, i, c);
    const b = latticeValue(s, i + 1, c);
    return a + (b - a) * f;
  };
  return {
    sample(t: number, speed: number, spin: number): Vec3 {
      if (!(speed > KNUCKLE_MIN_SPEED) || !(spin < KNUCKLE_MAX_SPIN)) return { x: 0, y: 0, z: 0 };
      let x = channel(t, 0) * KNUCKLE_MAX_ACCEL;
      let y = channel(t, 1) * KNUCKLE_MAX_ACCEL;
      const m = Math.hypot(x, y);
      if (m > KNUCKLE_MAX_ACCEL) {
        x *= KNUCKLE_MAX_ACCEL / m;
        y *= KNUCKLE_MAX_ACCEL / m;
      }
      return { x, y, z: 0 };
    },
  };
}
