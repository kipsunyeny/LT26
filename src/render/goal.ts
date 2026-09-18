// Goal frames (posts, bar, net supports) and the net (alpha-textured planes). Both ends are built so the
// replay/title cameras never see an empty far end; each part is merged into one mesh (2 draw calls total).
import * as THREE from 'three';
import { cylinderBetween, makeCanvas, merge, painted } from './geom';
import { PITCH } from './pitch';

export const GOAL = {
  halfWidth: 3.66,
  height: 2.44,
  postRadius: 0.06,
  depth: 2.0,
  /** Net mesh cell size, m. */
  cell: 0.12,
} as const;

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function frameParts(): THREE.BufferGeometry[] {
  const r = GOAL.postRadius;
  const cx = GOAL.halfWidth + r;
  const top = GOAL.height + r;
  const d = GOAL.depth;
  const parts: THREE.BufferGeometry[] = [];
  const white = 0xffffff;
  const grey = 0xd9dde2;
  // Posts and crossbar (centre lines at x = ±3.72, y = 2.50 on z = 0).
  parts.push(painted(cylinderBetween(V(-cx, 0, 0), V(-cx, top, 0), r, 16), white));
  parts.push(painted(cylinderBetween(V(cx, 0, 0), V(cx, top, 0), r, 16), white));
  parts.push(painted(cylinderBetween(V(-cx, top, 0), V(cx, top, 0), r, 16), white));
  for (const sx of [-1, 1]) {
    const cap = new THREE.SphereGeometry(r, 12, 8);
    cap.translate(sx * cx, top, 0);
    parts.push(painted(cap, white));
  }
  // Net supports: thin tubes along the box edges behind the line.
  const s = 0.025;
  const nx = GOAL.halfWidth;
  const ny = GOAL.height;
  const edges: [THREE.Vector3, THREE.Vector3][] = [
    [V(-nx, ny, 0), V(-nx, ny, -d)],
    [V(nx, ny, 0), V(nx, ny, -d)],
    [V(-nx, ny, -d), V(nx, ny, -d)],
    [V(-nx, 0, -d), V(-nx, ny, -d)],
    [V(nx, 0, -d), V(nx, ny, -d)],
    [V(-nx, s, -d), V(nx, s, -d)],
    [V(-nx, s, 0), V(-nx, s, -d)],
    [V(nx, s, 0), V(nx, s, -d)],
  ];
  for (const [a, b] of edges) parts.push(painted(cylinderBetween(a, b, s, 6), grey));
  return parts;
}

/** A plane with UVs in net cells (u,v = metres / cell). */
function netPlane(w: number, h: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h, 1, 1);
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / GOAL.cell, (uv.getY(i) * h) / GOAL.cell);
  return g;
}

function netParts(): THREE.BufferGeometry[] {
  const w = GOAL.halfWidth * 2;
  const h = GOAL.height;
  const d = GOAL.depth;
  const back = netPlane(w, h);
  back.translate(0, h / 2, -d);
  const top = netPlane(w, d);
  top.rotateX(-Math.PI / 2);
  top.translate(0, h, -d / 2);
  const left = netPlane(d, h);
  left.rotateY(Math.PI / 2);
  left.translate(-GOAL.halfWidth, h / 2, -d / 2);
  const right = netPlane(d, h);
  right.rotateY(-Math.PI / 2);
  right.translate(GOAL.halfWidth, h / 2, -d / 2);
  return [back, top, left, right];
}

/** Places a copy of the near-end parts at the far end (rotated 180° about y, goal line at z = length). */
function farCopy(parts: THREE.BufferGeometry[]): THREE.BufferGeometry[] {
  return parts.map((p) => {
    const c = p.clone();
    c.rotateY(Math.PI);
    c.translate(0, 0, PITCH.length);
    return c;
  });
}

function netTexture(maxAniso: number): THREE.CanvasTexture {
  const n = 64;
  const { canvas, ctx } = makeCanvas(n, n);
  ctx.clearRect(0, 0, n, n);
  ctx.strokeStyle = 'rgba(255,255,255,1)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(n, 0);
  ctx.moveTo(0, 0);
  ctx.lineTo(0, n);
  ctx.stroke();
  // Knots.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 5, 5);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(4, maxAniso);
  return tex;
}

export function createGoals(maxAniso: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'goals';
  const frame = frameParts();
  const frameGeo = merge([...frame, ...farCopy(frame)]);
  const frameMesh = new THREE.Mesh(frameGeo, new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x303030 }));
  frameMesh.name = 'goalFrame';
  group.add(frameMesh);
  const net = netParts();
  const netGeo = merge([...net, ...farCopy(net)]);
  const netMesh = new THREE.Mesh(
    netGeo,
    new THREE.MeshBasicMaterial({
      map: netTexture(maxAniso),
      color: 0xe6edf5,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  netMesh.name = 'net';
  netMesh.renderOrder = 1;
  group.add(netMesh);
  return group;
}
