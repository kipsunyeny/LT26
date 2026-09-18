// Camera rig: owns the Three camera, the kick-anchor tracker and the per-mode poses, and answers the screen
// queries. It needs no renderer, so it is unit-tested in Node.
//
// Consistency rule: after a frame(), queries use exactly the camera that frame was drawn with. Between a
// setMode()/setCamera() and the next frame() the camera would otherwise still be the old one (e.g. the title
// view), and a UI reading the ball position in that gap (first play frames can take seconds on slow GPUs while
// shaders compile) would get a wrong ball. So in that gap the queries use a provisional pose computed the same
// way the next frame will compute it.
import * as THREE from 'three';
import type { CameraMode, Vec3, WorldSnapshot } from '../contracts';
import {
  KICK_ANCHOR,
  KickAnchorTracker,
  kickBallNdcY,
  kickCameraPose,
  newPose,
  pathBounds,
  replayCameraPose,
  titleCameraPose,
  type CameraPose,
  type PathBounds,
} from './cameras';
import { projectToScreen, screenToPlaneZ0, sphereScreenRadius } from './projection';

/** A queried point counts as "the resting ball on the pitch" (provisional kick anchor) inside these bounds. */
const PROVISIONAL_MIN_Y = 0.05;
const PROVISIONAL_MIN_Z = 5;

export class CameraRig {
  readonly camera = new THREE.PerspectiveCamera(46, 16 / 10, 0.2, 900);
  width = 1;
  height = 1;
  private cam: CameraMode = 'kick';
  private readonly tracker = new KickAnchorTracker();
  private readonly pose = newPose();
  private replayTime = 0;
  private titleTime = 0;
  private bounds: PathBounds | null = null;
  /** True between a camera/mode change and the next frame. */
  private stale = true;
  private readonly provisional: Vec3 = { x: 0, y: 0.11, z: 0 };
  private hasProvisional = false;

  get mode(): CameraMode {
    return this.cam;
  }

  /** The kick spot the camera stands behind, if known. */
  get anchor(): Vec3 | null {
    return this.tracker.valid ? this.tracker.anchor : null;
  }

  setSize(width: number, height: number): void {
    this.width = Math.max(1, Math.round(width));
    this.height = Math.max(1, Math.round(height));
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
  }

  setMode(): void {
    this.tracker.requestSnap();
    this.replayTime = 0;
    this.markStale();
  }

  setCamera(mode: CameraMode): void {
    if (mode === this.cam) return;
    this.cam = mode;
    if (mode === 'kick') this.tracker.requestSnap();
    if (mode === 'replay') this.replayTime = 0;
    if (mode === 'title') this.titleTime = 0;
    this.markStale();
  }

  setPath(points: readonly Vec3[] | null): void {
    this.bounds = points && points.length > 0 ? pathBounds(points, points[0]) : null;
    if (this.cam === 'replay') this.markStale();
  }

  /** Positions the camera for the frame about to be drawn. clockDt = snapshot-clock step (else dt). */
  frame(world: WorldSnapshot, clockDt: number, dt: number): void {
    if (this.cam === 'kick') {
      this.tracker.update(world.ball.p, world.taker.p, clockDt);
      this.apply(kickCameraPose(this.tracker.anchor, this.tracker.side, kickBallNdcY(this.height), this.pose));
    } else if (this.cam === 'replay') {
      this.replayTime += dt;
      if (!this.bounds) this.bounds = pathBounds([], world.ball.p);
      this.apply(replayCameraPose(this.bounds, this.replayTime, this.width / this.height, this.pose));
    } else {
      this.titleTime += dt;
      this.apply(titleCameraPose(this.titleTime, this.pose));
    }
    this.stale = false;
    this.hasProvisional = false;
  }

  worldToScreen(p: Vec3): { x: number; y: number; visible: boolean } {
    this.ensure(p);
    return projectToScreen(this.camera, p, this.width, this.height);
  }

  screenToGoalPlane(sx: number, sy: number): { x: number; y: number } | null {
    this.ensure(null);
    return screenToPlaneZ0(this.camera, sx, sy, this.width, this.height);
  }

  /** Screen radius of the ball drawn at `ballPos` (or, in the gap before the next frame, of the resting ball). */
  ballScreenRadius(ballPos: Vec3, radius: number): number {
    this.ensure(ballPos);
    const c = this.stale && this.hasProvisional ? this.provisional : ballPos;
    return sphereScreenRadius(this.camera, c, radius, this.width, this.height);
  }

  private markStale(): void {
    this.stale = true;
    this.hasProvisional = false;
  }

  /** In the gap before the next frame, move the camera to where that frame will put it. */
  private ensure(hint: Vec3 | null): void {
    if (!this.stale) return;
    if (this.cam === 'kick') {
      if (
        hint &&
        hint.y >= PROVISIONAL_MIN_Y &&
        hint.y < KICK_ANCHOR.groundY &&
        hint.z > PROVISIONAL_MIN_Z &&
        !this.hasProvisional
      ) {
        // The next frame snaps onto the resting ball beside the taker: the queried ball.
        this.provisional.x = hint.x;
        this.provisional.y = 0.11;
        this.provisional.z = hint.z;
        this.hasProvisional = true;
      }
      const a = this.hasProvisional ? this.provisional : this.tracker.valid ? this.tracker.anchor : null;
      if (a) this.apply(kickCameraPose(a, this.tracker.side, kickBallNdcY(this.height), this.pose));
    } else if (this.cam === 'replay') {
      if (this.bounds) this.apply(replayCameraPose(this.bounds, this.replayTime, this.width / this.height, this.pose));
    } else {
      this.apply(titleCameraPose(this.titleTime, this.pose));
    }
  }

  private apply(p: CameraPose): void {
    const c = this.camera;
    c.position.set(p.position.x, p.position.y, p.position.z);
    c.lookAt(p.target.x, p.target.y, p.target.z);
    if (c.fov !== p.fov) {
      c.fov = p.fov;
      c.updateProjectionMatrix();
    }
    c.updateMatrixWorld();
  }
}
