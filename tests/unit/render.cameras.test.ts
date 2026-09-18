import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Vec3 } from '../../src/contracts';
import {
  KICK_CAMERA,
  kickCameraPose,
  pathBounds,
  replayCameraPose,
  takerSide,
  titleCameraPose,
  type CameraPose,
} from '../../src/render/cameras';
import { projectToScreen, screenToPlaneZ0, sphereScreenRadius } from '../../src/render/projection';

const W = 1280;
const H = 800;

function cameraFrom(pose: CameraPose, aspect = W / H): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(pose.fov, aspect, 0.2, 900);
  cam.position.set(pose.position.x, pose.position.y, pose.position.z);
  cam.lookAt(pose.target.x, pose.target.y, pose.target.z);
  cam.updateMatrixWorld();
  return cam;
}

/** Talilei for a right-footer: 0.7 m to the kicker's left, 0.5 m behind the ball. */
function takerLeftOf(ball: Vec3): Vec3 {
  const len = Math.hypot(ball.x, ball.z);
  const d = { x: -ball.x / len, z: -ball.z / len };
  const r = { x: -d.z, z: d.x };
  return { x: ball.x - r.x * 0.7 - d.x * 0.5, y: 0, z: ball.z - r.z * 0.7 - d.z * 0.5 };
}

const spots: Vec3[] = [
  { x: 0, y: 0.11, z: 11 },
  { x: 4, y: 0.11, z: 22 },
  { x: -12, y: 0.11, z: 25 },
  { x: 0, y: 0.11, z: 35 },
];

describe('render cameras: takerSide', () => {
  it('is -1 left of the ball→goal line and +1 right of it', () => {
    const ball = { x: 0, y: 0.11, z: 20 };
    expect(takerSide(ball, { x: -0.7, y: 0, z: 20.5 })).toBe(-1);
    expect(takerSide(ball, { x: 0.7, y: 0, z: 20.5 })).toBe(1);
  });
});

describe('render cameras: kick camera', () => {
  it.each(spots)('sits 2.3 m high, 4–5 m behind the ball, looking at the goal (%o)', (ball) => {
    const pose = kickCameraPose(ball, -1);
    expect(pose.fov).toBe(46);
    expect(pose.position.y).toBeCloseTo(KICK_CAMERA.height, 6);
    const behind = Math.hypot(pose.position.x - ball.x, pose.position.z - ball.z);
    expect(behind).toBeGreaterThanOrEqual(4);
    expect(behind).toBeLessThanOrEqual(5);
    // Farther from the goal than the ball.
    expect(Math.hypot(pose.position.x, pose.position.z)).toBeGreaterThan(Math.hypot(ball.x, ball.z));
  });

  it.each(spots)('frames ball low-centre, Talilei lower-left and the goal upper-middle (%o)', (ball) => {
    const cam = cameraFrom(kickCameraPose(ball, -1));
    const b = projectToScreen(cam, ball, W, H);
    expect(b.visible).toBe(true);
    expect(b.y / H).toBeCloseTo((1 - KICK_CAMERA.ballNdcY) / 2, 3);
    expect(b.x / W).toBeGreaterThan(0.35);
    expect(b.x / W).toBeLessThan(0.55);
    // Talilei's body centre (0.9 m up) in the left half, below the goal.
    const t = takerLeftOf(ball);
    const tc = projectToScreen(cam, { x: t.x, y: 0.9, z: t.z }, W, H);
    expect(tc.visible).toBe(true);
    expect(tc.x / W).toBeLessThan(0.4);
    expect(tc.x).toBeLessThan(b.x);
    const feet = projectToScreen(cam, t, W, H);
    expect(feet.y / H).toBeGreaterThan(0.7);
    // Crossbar centre in the upper half, near the middle.
    const bar = projectToScreen(cam, { x: 0, y: 2.44, z: 0 }, W, H);
    expect(bar.visible).toBe(true);
    expect(bar.y / H).toBeLessThan(0.35);
    expect(Math.abs(bar.x / W - 0.5)).toBeLessThan(0.1);
    // Both posts in view.
    expect(projectToScreen(cam, { x: -3.66, y: 0, z: 0 }, W, H).visible).toBe(true);
    expect(projectToScreen(cam, { x: 3.66, y: 0, z: 0 }, W, H).visible).toBe(true);
  });

  it('mirrors the sideways shift for a left-footer', () => {
    const ball = { x: 0, y: 0.11, z: 22 };
    expect(kickCameraPose(ball, -1).position.x).toBeGreaterThan(0);
    expect(kickCameraPose(ball, 1).position.x).toBeLessThan(0);
  });
});

describe('render projection', () => {
  it('screenToGoalPlane inverts worldToScreen for points on z = 0', () => {
    const cam = cameraFrom(kickCameraPose({ x: 4, y: 0.11, z: 22 }, -1));
    for (const p of [
      { x: 0, y: 1.2, z: 0 },
      { x: -3.5, y: 2.3, z: 0 },
      { x: 3.2, y: 0.2, z: 0 },
      { x: 6, y: 3.5, z: 0 },
    ]) {
      const s = projectToScreen(cam, p, W, H);
      const back = screenToPlaneZ0(cam, s.x, s.y, W, H);
      expect(back).not.toBeNull();
      expect(back?.x).toBeCloseTo(p.x, 6);
      expect(back?.y).toBeCloseTo(p.y, 6);
    }
  });

  it('screenToGoalPlane returns null when the ray points away from the goal plane', () => {
    const cam = cameraFrom({ position: { x: 0, y: 2, z: 20 }, target: { x: 0, y: 2, z: 40 }, fov: 46 });
    expect(screenToPlaneZ0(cam, W / 2, H / 2, W, H)).toBeNull();
  });

  it('ball screen radius matches the pinhole model', () => {
    const pose = kickCameraPose({ x: 0, y: 0.11, z: 20 }, -1);
    const cam = cameraFrom(pose);
    const c = { x: 0, y: 0.11, z: 20 };
    const r = sphereScreenRadius(cam, c, 0.11, W, H);
    const d = new THREE.Vector3(c.x, c.y, c.z).applyMatrix4(cam.matrixWorldInverse).z * -1;
    const expected = (0.11 / d) * (H / 2 / Math.tan(THREE.MathUtils.degToRad(pose.fov / 2)));
    expect(r).toBeGreaterThan(expected * 0.95);
    expect(r).toBeLessThan(expected * 1.1);
  });
});

describe('render cameras: replay and title', () => {
  const path: Vec3[] = [];
  for (let i = 0; i <= 60; i++) {
    const s = i / 60;
    path.push({ x: 4 - 7 * s + 3 * (s * s - s), y: 0.11 + 4 * 2.4 * s * (1 - s) + 2 * s, z: 22 * (1 - s) });
  }

  it('keeps the whole flight path and the goal in view during the orbit', () => {
    const b = pathBounds(path, path[0]);
    for (const t of [0, 3, 6, 12, 18]) {
      for (const aspect of [16 / 10, 4 / 3, 2]) {
        const pose = replayCameraPose(b, t, aspect);
        const cam = cameraFrom(pose, aspect);
        for (const p of [...path, { x: -3.66, y: 2.44, z: 0 }, { x: 3.66, y: 0, z: 0 }]) {
          expect(projectToScreen(cam, p, W, H).visible).toBe(true);
        }
        expect(pose.position.y).toBeGreaterThan(b.center.y);
      }
    }
  });

  it('orbits slowly (less than 5° of azimuth per second)', () => {
    const b = pathBounds(path, path[0]);
    const a0 = replayCameraPose(b, 0, 1.6).position;
    const a1 = replayCameraPose(b, 1, 1.6).position;
    const ang = (p: Vec3) => Math.atan2(p.x - b.center.x, p.z - b.center.z);
    expect(Math.abs(ang(a1) - ang(a0))).toBeGreaterThan(0);
    expect(Math.abs(ang(a1) - ang(a0))).toBeLessThan((5 * Math.PI) / 180);
  });

  it('title view sees the goal mouth', () => {
    const cam = cameraFrom(titleCameraPose(0));
    expect(projectToScreen(cam, { x: 0, y: 1.2, z: 0 }, W, H).visible).toBe(true);
  });
});
