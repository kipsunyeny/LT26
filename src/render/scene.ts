// Scene assembly: renderer, lights, static stadium, dynamic actors, cameras and the SceneApi.
import * as THREE from 'three';
import type { CameraMode, Mode, SceneApi, SceneStats, Vec3, WorldSnapshot } from '../contracts';
import { BallView, BALL_RADIUS } from './ball';
import {
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
import { makeCanvas } from './geom';
import { createGoals } from './goal';
import { TalileiView } from './mascot';
import { projectToScreen, screenToPlaneZ0, sphereScreenRadius } from './projection';
import { createPitch } from './pitch';
import { KeeperView, OutfieldView } from './players';
import { createStadium, SKY_HORIZON } from './stadium';
import { TubeLine } from './trail';

export interface CreateSceneOptions {
  antialias?: boolean;
}

/** SceneApi plus two helpers used by the dev harness and perf measurements. */
export interface SceneDebugApi extends SceneApi {
  /** Resolves when async art (Talilei) has loaded (or failed). */
  readonly ready: Promise<void>;
  /** Hides/shows everything that moves (to measure the static scene alone). */
  setDynamicVisible(on: boolean): void;
}

export const MAX_PIXEL_RATIO = 2;
const TRAIL_COLOR = 0x3fc9fc;
const MAX_SHADOWS = 14;

function hasWebGL(): boolean {
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

function shadowTexture(): THREE.CanvasTexture {
  const n = 64;
  const { canvas, ctx } = makeCanvas(n, n);
  const g = ctx.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.75)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.45)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, n, n);
  return new THREE.CanvasTexture(canvas);
}

class BlobShadows {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly t = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly yAxis = new THREE.Vector3(0, 1, 0);

  constructor() {
    const g = new THREE.PlaneGeometry(1, 1);
    g.rotateX(-Math.PI / 2);
    this.mesh = new THREE.InstancedMesh(
      g,
      new THREE.MeshBasicMaterial({
        map: shadowTexture(),
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      }),
      MAX_SHADOWS,
    );
    this.mesh.name = 'shadows';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 0;
  }

  begin(): void {
    this.n = 0;
  }

  add(x: number, z: number, w: number, l: number, yaw = 0): void {
    if (this.n >= MAX_SHADOWS || w <= 0 || l <= 0) return;
    this.q.setFromAxisAngle(this.yAxis, yaw);
    this.t.set(x, 0.015, z);
    this.s.set(w, 1, l);
    this.m.compose(this.t, this.q, this.s);
    this.mesh.setMatrixAt(this.n++, this.m);
  }

  end(): void {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export function createScene(canvas: HTMLCanvasElement, opts: CreateSceneOptions = {}): SceneDebugApi {
  if (!hasWebGL()) throw new Error('WebGL 2 is not available');
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: opts.antialias ?? true,
    powerPreference: 'high-performance',
  });
  renderer.setClearColor(SKY_HORIZON, 1);
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY_HORIZON);
  scene.fog = new THREE.Fog(SKY_HORIZON, 110, 330);
  scene.add(new THREE.HemisphereLight(0xe4eeff, 0x3a5a34, 1.35));
  const key = new THREE.DirectionalLight(0xfff8ec, 1.5);
  key.position.set(-25, 45, 35);
  scene.add(key);

  // Static world.
  const stadium = createStadium(maxAniso);
  const pitch = createPitch(maxAniso);
  const goals = createGoals(maxAniso);
  scene.add(stadium, pitch, goals);
  for (const g of [stadium, pitch, goals]) {
    g.traverse((o) => {
      o.matrixAutoUpdate = false;
      o.updateMatrix();
    });
  }

  // Dynamic actors.
  const ball = new BallView();
  const outfield = new OutfieldView();
  const keeper = new KeeperView();
  const talilei = new TalileiView();
  const shadows = new BlobShadows();
  const trail = new TubeLine(TRAIL_COLOR, 1, 0.045, 0);
  const ghost = new TubeLine(0xffffff, 0.38, 0.035, 0.6);
  const aim = new TubeLine(TRAIL_COLOR, 0.7, 0.025, 0);
  trail.mesh.name = 'trail';
  ghost.mesh.name = 'ghost';
  aim.mesh.name = 'aim';
  ghost.mesh.renderOrder = 4;
  aim.mesh.renderOrder = 4;
  const dynamic: THREE.Object3D[] = [
    ball.mesh,
    outfield.mesh,
    keeper.group,
    talilei.mesh,
    shadows.mesh,
    trail.mesh,
    ghost.mesh,
    aim.mesh,
  ];
  scene.add(...dynamic);

  const camera = new THREE.PerspectiveCamera(46, 16 / 10, 0.2, 900);
  let cssW = 1;
  let cssH = 1;

  let camMode: CameraMode = 'kick';
  const tracker = new KickAnchorTracker();
  const pose = newPose();
  let replayTime = 0;
  let titleTime = 0;
  let bounds: PathBounds | null = null;
  let prevT: number | null = null;
  let lost = false;
  let lastFrameAt = 0;
  const stats: SceneStats = { drawCalls: 0, triangles: 0, frameMs: 0 };
  let dynamicVisible = true;

  const onLost = (e: Event) => {
    e.preventDefault();
    lost = true;
  };
  const onRestored = () => {
    lost = false;
  };
  canvas.addEventListener('webglcontextlost', onLost, false);
  canvas.addEventListener('webglcontextrestored', onRestored, false);

  function applyPose(p: CameraPose): void {
    camera.position.set(p.position.x, p.position.y, p.position.z);
    camera.lookAt(p.target.x, p.target.y, p.target.z);
    if (camera.fov !== p.fov) {
      camera.fov = p.fov;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
  }

  function updateCamera(world: WorldSnapshot, clockDt: number, dt: number): void {
    const aspect = cssW / Math.max(1, cssH);
    if (camMode === 'kick') {
      tracker.update(world.ball.p, world.taker.p, clockDt);
      applyPose(kickCameraPose(tracker.anchor, tracker.side, kickBallNdcY(cssH), pose));
    } else if (camMode === 'replay') {
      replayTime += dt;
      if (!bounds) bounds = pathBounds([], world.ball.p);
      applyPose(replayCameraPose(bounds, replayTime, aspect, pose));
    } else {
      titleTime += dt;
      applyPose(titleCameraPose(titleTime, pose));
    }
    const e = camera.position;
    trail.setEye(e.x, e.y, e.z);
    ghost.setEye(e.x, e.y, e.z);
    aim.setEye(e.x, e.y, e.z);
  }

  function updateShadows(world: WorldSnapshot): void {
    shadows.begin();
    const b = world.ball.p;
    const fade = Math.max(0.25, 1 - b.y / 8);
    shadows.add(b.x, b.z, 0.3 * fade, 0.3 * fade);
    const k = world.keeper;
    const lean = Math.sin(k.lean);
    shadows.add(k.p.x + lean * 0.8, k.p.z, 0.8 + Math.abs(lean) * 1.3, 0.55);
    for (const w of world.wall) {
      const s = Math.max(0.5, 1 - w.jump);
      shadows.add(w.p.x, w.p.z, 0.75 * s, 0.5 * s);
    }
    if (world.defender) shadows.add(world.defender.p.x, world.defender.p.z, 0.75, 0.5);
    if (camMode !== 'title') shadows.add(world.taker.p.x, world.taker.p.z, 0.8, 0.5);
    shadows.end();
  }

  const api: SceneDebugApi = {
    ready: talilei.ready,

    setMode(_mode: Mode): void {
      tracker.requestSnap();
      replayTime = 0;
      prevT = null;
    },

    setCamera(mode: CameraMode): void {
      if (mode === camMode) return;
      camMode = mode;
      if (mode === 'kick') tracker.requestSnap();
      if (mode === 'replay') replayTime = 0;
      if (mode === 'title') titleTime = 0;
      prevT = null;
    },

    render(world: WorldSnapshot, dtIn: number): void {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (lastFrameAt > 0) {
        const interval = now - lastFrameAt;
        stats.frameMs = stats.frameMs === 0 ? interval : stats.frameMs * 0.9 + interval * 0.1;
      }
      lastFrameAt = now;
      const dt = Number.isFinite(dtIn) ? Math.min(Math.max(dtIn, 0), 0.1) : 0;
      // Spin uses the snapshot clock when it advances (slow-motion replays spin slowly), else frame time.
      const dT = prevT === null ? 0 : world.t - prevT;
      const spinDt = dT > 0 && dT <= 0.1 ? dT : dT === 0 ? dt : 0;
      const b = world.ball.p;
      prevT = world.t;

      updateCamera(world, dT > 0 ? dT : dt, dt);
      ball.update(b, world.ball.w, spinDt);
      keeper.update(world.keeper);
      outfield.update(world.wall, world.defender, tracker.valid ? tracker.anchor : b);
      talilei.update(world.taker.p, world.taker.stride, camera.position, camMode !== 'title');
      if (!dynamicVisible) talilei.mesh.visible = false;
      // Lines belong to play/replay only; the title backdrop stays clean.
      const showLines = dynamicVisible && camMode !== 'title';
      trail.mesh.visible = showLines && trail.indexCount > 0;
      ghost.mesh.visible = showLines && ghost.indexCount > 0;
      aim.mesh.visible = showLines && aim.indexCount > 0;
      updateShadows(world);

      if (lost) return;
      renderer.render(scene, camera);
      stats.drawCalls = renderer.info.render.calls;
      stats.triangles = renderer.info.render.triangles;
    },

    setTrail(points: Vec3[] | null, ghostPts?: Vec3[] | null): void {
      const changed = trail.set(points);
      if (changed !== 'unchanged') bounds = points && points.length > 0 ? pathBounds(points, points[0]) : null;
      if (ghostPts !== undefined) ghost.set(ghostPts);
      if (!dynamicVisible) {
        trail.mesh.visible = false;
        ghost.mesh.visible = false;
      }
    },

    setAimPreview(points: Vec3[] | null): void {
      aim.set(points);
      if (!dynamicVisible) aim.mesh.visible = false;
    },

    worldToScreen(p: Vec3): { x: number; y: number; visible: boolean } {
      return projectToScreen(camera, p, cssW, cssH);
    },

    screenToGoalPlane(sx: number, sy: number): { x: number; y: number } | null {
      return screenToPlaneZ0(camera, sx, sy, cssW, cssH);
    },

    ballScreenRadius(): number {
      return sphereScreenRadius(camera, ball.mesh.position, BALL_RADIUS, cssW, cssH);
    },

    resize(width: number, height: number, pixelRatio: number): void {
      cssW = Math.max(1, Math.round(width));
      cssH = Math.max(1, Math.round(height));
      const pr = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
      renderer.setPixelRatio(Math.min(pr, MAX_PIXEL_RATIO));
      renderer.setSize(cssW, cssH, false);
      camera.aspect = cssW / cssH;
      camera.updateProjectionMatrix();
    },

    getStats(): SceneStats {
      return { ...stats };
    },

    setDynamicVisible(on: boolean): void {
      dynamicVisible = on;
      for (const o of dynamic) o.visible = on;
      if (on) {
        // Restore the visibility rules of the actors that manage it themselves.
        trail.mesh.visible = trail.indexCount > 0;
        ghost.mesh.visible = ghost.indexCount > 0;
        aim.mesh.visible = aim.indexCount > 0;
      }
    },

    dispose(): void {
      canvas.removeEventListener('webglcontextlost', onLost, false);
      canvas.removeEventListener('webglcontextrestored', onRestored, false);
      ball.dispose();
      outfield.dispose();
      keeper.dispose();
      talilei.dispose();
      trail.dispose();
      ghost.dispose();
      aim.dispose();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            const mm = m as THREE.MeshBasicMaterial;
            mm.map?.dispose();
            mm.dispose();
          }
        }
      });
      renderer.dispose();
    },
  };

  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  api.resize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight, dpr);
  return api;
}
