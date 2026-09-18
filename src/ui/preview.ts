// Aim-preview cache and throttle. sim.previewPath integrates a whole trajectory (10–19 ms on a
// tablet), so the HUD computes at most one per frame, at most PREVIEW_MIN_INTERVAL_MS apart, and
// reuses results for an identical (aim, speed, spins, spot, altitude) key.
import type { KickIntent, Vec3 } from '../contracts';

export const PREVIEW_MIN_INTERVAL_MS = 100;
export const PREVIEW_CACHE_SIZE = 48;

const r = (v: number, step: number): string => String(Math.round(v / step));

/** Cache key: quantised aim, power, spins and kind, plus the context (spot, mode, altitude…). */
export function previewKey(i: KickIntent, context: string): string {
  const aim =
    i.aim.kind === 'target'
      ? `t${r(i.aim.x, 0.01)},${r(i.aim.y, 0.01)}`
      : `a${r(i.aim.azimuth, 0.0005)},${r(i.aim.elevation, 0.0005)}`;
  return `${context}|${i.kind}|${aim}|p${r(i.power, 0.005)}|s${r(i.sideSpin, 0.05)}|d${r(i.topSpin, 0.05)}`;
}

export interface PreviewCache {
  /**
   * Cached points for `key`, or freshly computed ones if the throttle allows (at most one computation
   * per PREVIEW_MIN_INTERVAL_MS), else undefined (try again on a later frame).
   */
  get(key: string, compute: () => Vec3[], nowMs: number): Vec3[] | undefined;
  readonly computations: number;
}

export function createPreviewCache(minIntervalMs = PREVIEW_MIN_INTERVAL_MS, size = PREVIEW_CACHE_SIZE): PreviewCache {
  const map = new Map<string, Vec3[]>();
  let last = -Infinity;
  let count = 0;
  return {
    get(key, compute, nowMs) {
      const hit = map.get(key);
      if (hit) {
        map.delete(key);
        map.set(key, hit);
        return hit;
      }
      if (nowMs - last < minIntervalMs) return undefined;
      last = nowMs;
      count += 1;
      const pts = compute();
      map.set(key, pts);
      if (map.size > size) map.delete(map.keys().next().value as string);
      return pts;
    },
    get computations() {
      return count;
    },
  };
}
