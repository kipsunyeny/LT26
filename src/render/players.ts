// Players: wall defenders + long-shot defender share one InstancedMesh (red); the keeper (green) is a
// body mesh plus instanced arms and gloves posed from KeeperPose. 4 draw calls.
import * as THREE from 'three';
import type { KeeperPose, Vec3 } from '../contracts';
import { cylinderBetween, merge, painted } from './geom';

const SKIN = 0x6b4423;
const HAIR = 0x1a1410;
const BOOT = 0x111111;

interface Kit {
  shirt: number;
  shorts: number;
  socks: number;
}

export const WALL_KIT: Kit = { shirt: 0xc8102e, shorts: 0xf2f2f2, socks: 0xc8102e };
export const KEEPER_KIT: Kit = { shirt: 0x1f9d55, shorts: 0x14171c, socks: 0x1f9d55 };

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function capsule(a: THREE.Vector3, b: THREE.Vector3, r: number, color: number): THREE.BufferGeometry {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const g = new THREE.CapsuleGeometry(r, len, 3, 10);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), dir.normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return painted(g, color);
}

/** Lower body + torso + head, feet at y = 0, facing +z. withArms adds the wall pose (hands in front). */
function bodyGeometry(kit: Kit, withArms: boolean): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    const x = sx * 0.1;
    parts.push(capsule(V(x, 0.12, 0), V(x, 0.42, 0), 0.065, kit.socks));
    parts.push(capsule(V(x, 0.5, 0), V(x, 0.78, 0), 0.08, SKIN));
    const boot = new THREE.BoxGeometry(0.11, 0.08, 0.26);
    boot.translate(x, 0.04, 0.04);
    parts.push(painted(boot, BOOT));
  }
  const shorts = new THREE.CylinderGeometry(0.2, 0.23, 0.3, 12);
  shorts.translate(0, 0.86, 0);
  parts.push(painted(shorts, kit.shorts));
  const torso = new THREE.CapsuleGeometry(0.2, 0.42, 4, 12);
  torso.scale(1.1, 1, 0.72);
  torso.translate(0, 1.23, 0);
  parts.push(painted(torso, kit.shirt));
  parts.push(capsule(V(0, 1.55, 0), V(0, 1.64, 0), 0.06, SKIN));
  const head = new THREE.SphereGeometry(0.115, 14, 10);
  head.translate(0, 1.73, 0.01);
  parts.push(painted(head, SKIN));
  const hair = new THREE.SphereGeometry(0.12, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.45);
  hair.translate(0, 1.745, -0.005);
  parts.push(painted(hair, HAIR));
  if (withArms) {
    for (const sx of [-1, 1]) {
      const sh = V(sx * 0.25, 1.46, 0);
      const el = V(sx * 0.2, 1.12, 0.1);
      const hand = V(sx * 0.07, 0.92, 0.17);
      parts.push(capsule(sh, el, 0.058, kit.shirt));
      parts.push(capsule(el, hand, 0.05, SKIN));
    }
  }
  return merge(parts);
}

const MAX_OUTFIELD = 8;

export class OutfieldView {
  readonly mesh: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3(1, 1, 1);
  private readonly t = new THREE.Vector3();
  private readonly yAxis = new THREE.Vector3(0, 1, 0);

  constructor() {
    this.mesh = new THREE.InstancedMesh(
      bodyGeometry(WALL_KIT, true),
      new THREE.MeshLambertMaterial({ vertexColors: true }),
      MAX_OUTFIELD,
    );
    this.mesh.name = 'outfield';
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
  }

  /** Wall players (and the optional long-shot defender) face `facing` (usually the ball's resting spot). */
  update(wall: readonly { p: Vec3; jump: number }[], defender: { p: Vec3 } | null, facing: Vec3): void {
    let n = 0;
    for (let i = 0; i < wall.length && n < MAX_OUTFIELD; i++) this.place(n++, wall[i].p, wall[i].jump, facing);
    if (defender && n < MAX_OUTFIELD) this.place(n++, defender.p, 0, facing);
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  private place(i: number, p: Vec3, jump: number, facing: Vec3): void {
    this.q.setFromAxisAngle(this.yAxis, Math.atan2(facing.x - p.x, facing.z - p.z));
    this.t.set(p.x, p.y + Math.max(0, jump), p.z);
    this.m.compose(this.t, this.q, this.s);
    this.mesh.setMatrixAt(i, this.m);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}

/** Shoulder positions in the keeper's body frame (feet at origin, facing +z). */
const SHOULDERS = [V(-0.26, 1.47, 0), V(0.26, 1.47, 0)];

export class KeeperView {
  readonly group = new THREE.Group();
  private readonly body: THREE.Mesh;
  private readonly arms: THREE.InstancedMesh;
  private readonly gloves: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly tmp3 = new THREE.Vector3();
  private readonly tmp4 = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor() {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.body = new THREE.Mesh(bodyGeometry(KEEPER_KIT, false), mat);
    const armGeo = painted(cylinderBetween(V(0, -0.5, 0), V(0, 0.5, 0), 0.055, 8), KEEPER_KIT.shirt);
    this.arms = new THREE.InstancedMesh(armGeo, mat, 2);
    const gloveGeo = painted(new THREE.SphereGeometry(0.085, 10, 8), 0xe9f7ee);
    this.gloves = new THREE.InstancedMesh(gloveGeo, mat, 2);
    this.arms.frustumCulled = false;
    this.gloves.frustumCulled = false;
    this.group.name = 'keeper';
    this.group.add(this.body, this.arms, this.gloves);
  }

  /** Body root at p + lift, rotated by −lean about z (lean > 0 lays the body towards +x). */
  update(k: KeeperPose): void {
    this.body.position.set(k.p.x, k.p.y + Math.max(0, k.lift), k.p.z);
    this.body.rotation.set(0, 0, -k.lean);
    this.body.updateMatrixWorld();
    for (let i = 0; i < 2; i++) {
      const shoulder = this.tmp.copy(SHOULDERS[i]).applyMatrix4(this.body.matrixWorld);
      const hand = this.tmp2.set(k.hands[i].x, k.hands[i].y, k.hands[i].z);
      const dir = this.tmp3.subVectors(hand, shoulder);
      const len = Math.max(0.05, dir.length());
      this.q.setFromUnitVectors(this.up, dir.normalize());
      this.s.set(1, len, 1);
      this.m.compose(this.tmp4.addVectors(shoulder, hand).multiplyScalar(0.5), this.q, this.s);
      this.arms.setMatrixAt(i, this.m);
      this.m.makeTranslation(hand.x, hand.y, hand.z);
      this.gloves.setMatrixAt(i, this.m);
    }
    this.arms.instanceMatrix.needsUpdate = true;
    this.gloves.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.body.geometry.dispose();
    this.arms.geometry.dispose();
    this.gloves.geometry.dispose();
    (this.body.material as THREE.Material).dispose();
    this.arms.dispose();
    this.gloves.dispose();
  }
}
