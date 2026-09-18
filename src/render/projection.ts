// Screen <-> world helpers shared by the scene and the unit tests (Three.js math only, no renderer).
import * as THREE from 'three';
import type { Vec3 } from '../contracts';

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const ndc = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
const goalPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

/** World point -> CSS pixels relative to the canvas; visible = inside the frustum. */
export function projectToScreen(
  camera: THREE.Camera,
  p: Vec3,
  width: number,
  height: number,
): { x: number; y: number; visible: boolean } {
  tmpA.set(p.x, p.y, p.z).project(camera);
  const visible = tmpA.z > -1 && tmpA.z < 1 && Math.abs(tmpA.x) <= 1 && Math.abs(tmpA.y) <= 1;
  return { x: ((tmpA.x + 1) / 2) * width, y: ((1 - tmpA.y) / 2) * height, visible };
}

/** CSS pixel -> intersection of the view ray with the goal plane z = 0, or null if the ray misses it. */
export function screenToPlaneZ0(
  camera: THREE.Camera,
  sx: number,
  sy: number,
  width: number,
  height: number,
): { x: number; y: number } | null {
  ndc.set((sx / width) * 2 - 1, 1 - (sy / height) * 2);
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.ray.intersectPlane(goalPlane, tmpB);
  return hit ? { x: hit.x, y: hit.y } : null;
}

/** Screen radius (CSS px) of a sphere of radius r at centre c (offset along the camera's up axis). */
export function sphereScreenRadius(camera: THREE.Camera, c: Vec3, r: number, width: number, height: number): number {
  tmpA.set(c.x, c.y, c.z).project(camera);
  tmpB.set(0, 1, 0).applyQuaternion(camera.quaternion).multiplyScalar(r);
  tmpB.set(tmpB.x + c.x, tmpB.y + c.y, tmpB.z + c.z).project(camera);
  return Math.hypot(((tmpB.x - tmpA.x) / 2) * width, ((tmpB.y - tmpA.y) / 2) * height);
}
