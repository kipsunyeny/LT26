// Fallback projection used when the 3D scene is unavailable (no WebGL): a pinhole camera that
// mimics the kick camera (2.3 m high, 4.5 m behind the ball, 46° vertical FOV, pitched down 12°),
// so the ball sits near the bottom centre and the goal face in the upper middle of the screen.
import type { Vec3 } from '../contracts';

export interface Projector {
  worldToScreen(p: Vec3): { x: number; y: number; visible: boolean };
  screenToGoalPlane(sx: number, sy: number): { x: number; y: number } | null;
  /** Screen radius (px) of a ball of radius 0.11 m at p. */
  radiusAt(p: Vec3): number;
}

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};

export const FALLBACK_CAM = { height: 2.3, back: 4.5, fovDeg: 46, pitchDeg: -12 };

export function createFallbackProjector(ball: Vec3, width: number, height: number): Projector {
  const hl = Math.hypot(ball.x, ball.z) || 1;
  const back = { x: ball.x / hl, y: 0, z: ball.z / hl };
  const eye = {
    x: ball.x + back.x * FALLBACK_CAM.back,
    y: FALLBACK_CAM.height,
    z: ball.z + back.z * FALLBACK_CAM.back,
  };
  const pitch = (FALLBACK_CAM.pitchDeg * Math.PI) / 180;
  const fwd = norm({ x: -back.x * Math.cos(pitch), y: Math.sin(pitch), z: -back.z * Math.cos(pitch) });
  const right = norm(cross(fwd, { x: 0, y: 1, z: 0 }));
  const up = cross(right, fwd);
  const f = height / 2 / Math.tan((FALLBACK_CAM.fovDeg * Math.PI) / 360);
  const cx = width / 2;
  const cy = height / 2;
  const camZ = (p: Vec3): number => dot(sub(p, eye), fwd);
  return {
    worldToScreen(p) {
      const d = sub(p, eye);
      const z = dot(d, fwd);
      if (z <= 0.05) return { x: cx, y: cy, visible: false };
      const x = cx + (f * dot(d, right)) / z;
      const y = cy - (f * dot(d, up)) / z;
      return { x, y, visible: x >= 0 && y >= 0 && x <= width && y <= height };
    },
    screenToGoalPlane(sx, sy) {
      const a = (sx - cx) / f;
      const b = -(sy - cy) / f;
      const dir = {
        x: fwd.x + right.x * a + up.x * b,
        y: fwd.y + right.y * a + up.y * b,
        z: fwd.z + right.z * a + up.z * b,
      };
      if (Math.abs(dir.z) < 1e-9) return null;
      const t = -eye.z / dir.z;
      if (t <= 0) return null;
      return { x: eye.x + dir.x * t, y: eye.y + dir.y * t };
    },
    radiusAt(p) {
      const z = camZ(p);
      return z > 0.05 ? (f * 0.11) / z : 0;
    },
  };
}
