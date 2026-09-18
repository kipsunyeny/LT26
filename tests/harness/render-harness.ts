// Dev-only harness: builds the scene with hand-made WorldSnapshots.
// URL: /tests/harness/render.html?cam=kick|replay|title&mode=freeKick|penalty|longShot[&markers=1][&static=1]
import type { CameraMode, Mode, Vec3, WorldSnapshot } from '../../src/contracts';
import { createScene } from '../../src/render';
import { processTalileiImage } from '../../src/render/mascot';

interface HarnessState {
  ready: boolean;
  frames: number;
  stats: { drawCalls: number; triangles: number; frameMs: number } | null;
  ball: { x: number; y: number; r: number; visible: boolean } | null;
  roundTrip: { x: number; y: number } | null;
}

const q = new URLSearchParams(location.search);
const cam = (q.get('cam') ?? 'kick') as CameraMode;
const mode = (q.get('mode') ?? 'freeKick') as Mode;
const state: HarnessState = { ready: false, frames: 0, stats: null, ball: null, roundTrip: null };
(window as unknown as { __harness: HarnessState }).__harness = state;

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

/** Ball resting spot per mode (free kick: right edge of the D, 22 m). */
function spot(m: Mode): Vec3 {
  if (m === 'penalty') return v(0, 0.11, 11);
  if (m === 'longShot') return v(-5, 0.11, 27);
  return v(4, 0.11, 22);
}

/** Talilei beside the ball: 0.7 m to the kicker's left, 0.5 m behind (right-footer). */
function takerSpot(ball: Vec3): Vec3 {
  const len = Math.hypot(ball.x, ball.z);
  const d = { x: -ball.x / len, z: -ball.z / len };
  const right = { x: -d.z, z: d.x };
  return v(ball.x - right.x * 0.7 - d.x * 0.5, 0, ball.z - right.z * 0.7 - d.z * 0.5);
}

/** A 60 Hz hand-made curved path from start to target on the goal plane. */
function curvedPath(start: Vec3, target: { x: number; y: number }, apex: number, curve: number, secs: number): Vec3[] {
  const pts: Vec3[] = [];
  const n = Math.round(secs * 60);
  const len = Math.hypot(start.x - target.x, start.z);
  const right = { x: start.z / len, z: (target.x - start.x) / len };
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    const lat = curve * (s * s - s);
    pts.push(
      v(
        start.x + (target.x - start.x) * s + right.x * lat,
        start.y + (target.y - start.y) * s + 4 * apex * s * (1 - s),
        start.z * (1 - s) + right.z * lat,
      ),
    );
  }
  // Into the net.
  const last = pts[pts.length - 1];
  for (let i = 1; i <= 20; i++) pts.push(v(last.x, Math.max(0.11, last.y - i * 0.05), -i * 0.08));
  return pts;
}

function wallFor(ball: Vec3, count: number): { p: Vec3; jump: number }[] {
  // 9.15 m from the ball towards the near post (x = +3.66 side for a ball right of centre).
  const post = v(ball.x >= 0 ? 3.2 : -3.2, 0, 0);
  const dx = post.x - ball.x;
  const dz = post.z - ball.z;
  const l = Math.hypot(dx, dz);
  const c = v(ball.x + (dx / l) * 9.15, 0, ball.z + (dz / l) * 9.15);
  const px = -dz / l;
  const pz = dx / l;
  const out: { p: Vec3; jump: number }[] = [];
  for (let i = 0; i < count; i++) {
    const o = (i - (count - 1) / 2) * 0.52;
    out.push({ p: v(c.x + px * o, 0, c.z + pz * o), jump: 0 });
  }
  return out;
}

function snapshot(
  m: Mode,
  camMode: CameraMode,
): { world: WorldSnapshot; trail: Vec3[] | null; ghost: Vec3[] | null; aim: Vec3[] | null } {
  const ball = spot(m);
  const flight = camMode === 'replay';
  const target = m === 'penalty' ? { x: -2.9, y: 1.9 } : m === 'longShot' ? { x: 2.6, y: 2.1 } : { x: -2.95, y: 2.09 };
  const curve = m === 'penalty' ? 0.3 : m === 'longShot' ? -1.5 : 3.2;
  const path = curvedPath(ball, target, m === 'penalty' ? 0.4 : 2.4, curve, m === 'penalty' ? 0.43 : 1.05);
  const ghost = curvedPath(ball, { x: target.x + 0.9, y: target.y - 0.6 }, m === 'penalty' ? 0.3 : 2.1, curve * 0.8, 1);
  const flightFrames = path.length - 20;
  const flightBall = path[Math.round(flightFrames * 0.62)];
  const keeperX = m === 'freeKick' ? -1.0 : 0;
  const dive = flight && m === 'penalty';
  const keeper = dive
    ? {
        p: v(-0.4, 0, 0.3),
        lean: -1.0,
        lift: 0.45,
        hands: [v(-2.0, 1.55, 0.3), v(-1.85, 1.95, 0.3)] as [Vec3, Vec3],
      }
    : {
        p: v(keeperX, 0, 0.4),
        lean: 0,
        lift: 0,
        hands: [v(keeperX - 0.42, 1.05, 0.55), v(keeperX + 0.42, 1.05, 0.55)] as [Vec3, Vec3],
      };
  const world: WorldSnapshot = {
    t: 0,
    ball: { p: flight ? flightBall : ball, w: flight ? v(0, -50, 0) : v(0, 0, 0) },
    keeper,
    wall: m === 'freeKick' ? wallFor(ball, 4) : [],
    defender: m === 'longShot' ? { p: v(-3.2, 0, 19.5) } : null,
    taker: { p: takerSpot(ball), stride: 1 },
  };
  return {
    world,
    trail: flight ? path : null,
    ghost: m === 'penalty' ? null : ghost,
    aim: flight ? null : path.slice(0, Math.round(path.length * 0.45)),
  };
}

function showMascot(): void {
  const img = new Image();
  img.onload = () => {
    const c = processTalileiImage(img, img.naturalWidth, img.naturalHeight);
    c.id = 'mascot';
    c.style.height = '100%';
    c.style.width = 'auto';
    document.body.replaceChildren(c);
    state.ready = true;
  };
  img.src = new URL('../../assets/brand/talilei-1024.webp', import.meta.url).href;
}

function main(): void {
  if (q.get('view') === 'mascot') {
    showMascot();
    return;
  }
  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const scene = createScene(canvas, {});
  scene.setMode(mode);
  scene.setCamera(cam);
  const snap = snapshot(mode, cam);
  scene.setTrail(snap.trail, snap.ghost);
  scene.setAimPreview(snap.aim);
  if (q.get('static') === '1') scene.setDynamicVisible(false);
  const markers = q.get('markers') === '1';
  const marker = document.createElement('div');
  marker.className = 'marker';
  if (markers) document.body.appendChild(marker);
  window.addEventListener('resize', () => scene.resize(innerWidth, innerHeight, devicePixelRatio));
  scene.resize(innerWidth, innerHeight, devicePixelRatio);
  let last = performance.now();
  const frame = (now: number) => {
    const dt = (now - last) / 1000;
    last = now;
    snap.world.t += cam === 'replay' ? 0 : dt;
    scene.render(snap.world, dt);
    state.frames++;
    state.stats = scene.getStats();
    const s = scene.worldToScreen(snap.world.ball.p);
    const r = scene.ballScreenRadius();
    state.ball = { x: s.x, y: s.y, r, visible: s.visible };
    const goalPt = scene.worldToScreen(v(-2.5, 1.8, 0));
    state.roundTrip = scene.screenToGoalPlane(goalPt.x, goalPt.y);
    if (markers) {
      marker.style.left = `${s.x - r}px`;
      marker.style.top = `${s.y - r}px`;
      marker.style.width = marker.style.height = `${2 * r}px`;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  void scene.ready.then(() => {
    state.ready = true;
  });
}

main();
