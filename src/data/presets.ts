// Spot presets for every mode. Keys are stable: the session log stores statistics per key.
import type { Mode, SpotPreset, Vec3 } from '../contracts';

const BALL_Y = 0.11;
const at = (x: number, z: number): Vec3 => ({ x, y: BALL_Y, z });

export const SPOTS: Record<Mode, SpotPreset[]> = {
  freeKick: [
    { key: 'fk-centre', label: 'Centre of the D', ball: at(0, 22) },
    { key: 'fk-left-d', label: 'Left edge of the D', ball: at(-6, 18.5) },
    { key: 'fk-right-d', label: 'Right edge of the D', ball: at(6, 18.5) },
    { key: 'fk-wide-left', label: 'Wide left', ball: at(-15, 18.5) },
    { key: 'fk-wide-right', label: 'Wide right', ball: at(15, 18.5) },
  ],
  penalty: [{ key: 'pk-spot', label: 'Penalty spot', ball: at(0, 11) }],
  longShot: [
    { key: 'ls-centre', label: 'Centre, 26 m', ball: at(0, 26) },
    { key: 'ls-left', label: 'Left, 27 m', ball: at(-9, 25) },
    { key: 'ls-right', label: 'Right, 27 m', ball: at(9, 25) },
  ],
};

export function defaultSpot(mode: Mode): SpotPreset {
  return SPOTS[mode][0];
}

export function findSpot(mode: Mode, key: string): SpotPreset | null {
  return SPOTS[mode].find((s) => s.key === key) ?? null;
}

/** Free-kick placement limits (distance of the ball from the goal centre, m). */
export const FREE_KICK_MIN_DIST = 16;
export const FREE_KICK_MAX_DIST = 35;
/** Penalty area: |x| ≤ 20.16 m and z ≤ 16.5 m. A direct free kick cannot be taken inside it. */
export const BOX_HALF_WIDTH = 20.16;
export const BOX_DEPTH = 16.5;

function validFreeKick(x: number, z: number): boolean {
  const d = Math.hypot(x, z);
  const inBox = Math.abs(x) <= BOX_HALF_WIDTH && z <= BOX_DEPTH;
  return z >= 1 && d >= FREE_KICK_MIN_DIST - 1e-9 && d <= FREE_KICK_MAX_DIST + 1e-9 && !inBox;
}

/**
 * Free placement: clamps a requested position to 16–35 m from the goal centre, outside the penalty
 * area and in front of the goal line, then snaps it to whole metres so the key `fk-x{X}-z{Z}` names
 * exactly one ball position.
 */
export function freeKickSpot(req: { x: number; z: number }): SpotPreset {
  let x = Number.isFinite(req.x) ? req.x : 0;
  let z = Number.isFinite(req.z) ? Math.max(req.z, 1) : 22;
  const d = Math.hypot(x, z);
  const target = Math.min(FREE_KICK_MAX_DIST, Math.max(FREE_KICK_MIN_DIST, d));
  if (d > 1e-9) {
    x *= target / d;
    z *= target / d;
  }
  let best: { x: number; z: number } | null = null;
  let bestD = Infinity;
  const rx = Math.round(x);
  const rz = Math.round(z);
  for (let r = 0; r <= 6 && !best; r++) {
    for (let ix = rx - r; ix <= rx + r; ix++) {
      for (let iz = rz - r; iz <= rz + r; iz++) {
        if (Math.max(Math.abs(ix - rx), Math.abs(iz - rz)) !== r || !validFreeKick(ix, iz)) continue;
        const e = Math.hypot(ix - x, iz - z);
        if (e < bestD) {
          bestD = e;
          best = { x: ix, z: iz };
        }
      }
    }
  }
  const p = best ?? { x: 0, z: 22 };
  const px = p.x === 0 ? 0 : p.x;
  return { key: `fk-x${px}-z${p.z}`, label: `Free kick ${Math.round(Math.hypot(p.x, p.z))} m`, ball: at(px, p.z) };
}
