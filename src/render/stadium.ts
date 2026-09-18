// Stadium: sky dome, one bowl of stands with a canvas crowd, structure (walls, roof, floodlight towers),
// advertising boards and floodlight glows. 5 draw calls in total.
import * as THREE from 'three';
import { GeoBuilder, cylinderBetween, makeCanvas, merge, painted, seeded } from './geom';

export const SKY_HORIZON = 0x0b2349;
const SKY_TOP = 0x01040d;

/** Rounded rectangle around the pitch; points counter-clockwise (seen from above) with outward normals. */
interface Ring {
  pts: { x: number; z: number; nx: number; nz: number; s: number }[];
}

function roundedRing(cx: number, cz: number, hx: number, hz: number, rc: number, segs: number): Ring {
  const corners = [
    { x: cx + hx - rc, z: cz + hz - rc, a0: 0 },
    { x: cx - hx + rc, z: cz + hz - rc, a0: Math.PI / 2 },
    { x: cx - hx + rc, z: cz - hz + rc, a0: Math.PI },
    { x: cx + hx - rc, z: cz - hz + rc, a0: 1.5 * Math.PI },
  ];
  const pts: Ring['pts'] = [];
  let s = 0;
  for (const c of corners) {
    for (let i = 0; i <= segs; i++) {
      const a = c.a0 + (Math.PI / 2) * (i / segs);
      const nx = Math.cos(a);
      const nz = Math.sin(a);
      const x = c.x + rc * nx;
      const z = c.z + rc * nz;
      const prev = pts[pts.length - 1];
      if (prev) s += Math.hypot(x - prev.x, z - prev.z);
      pts.push({ x, z, nx, nz, s });
    }
  }
  const first = pts[0];
  const last = pts[pts.length - 1];
  pts.push({ ...first, s: s + Math.hypot(first.x - last.x, first.z - last.z) });
  return { pts };
}

/** Strip between two offsets/heights of a ring. uScale = metres per texture repeat along the ring. */
function ringStrip(
  ring: Ring,
  off0: number,
  y0: number,
  off1: number,
  y1: number,
  uScale: number,
  facingIn: boolean,
): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const run = off1 - off0;
  const rise = y1 - y0;
  const len = Math.hypot(run, rise) || 1;
  // Normal of the surface, pointing towards the pitch (inward/up) or outward.
  const sgn = facingIn ? 1 : -1;
  const nh = (-rise / len) * sgn;
  const nv = (run / len) * sgn;
  let prevA = -1;
  let prevB = -1;
  for (const p of ring.pts) {
    const u = p.s / uScale;
    const a = b.vertex(p.x + p.nx * off0, y0, p.z + p.nz * off0, p.nx * nh, nv, p.nz * nh, u, 0);
    const c = b.vertex(p.x + p.nx * off1, y1, p.z + p.nz * off1, p.nx * nh, nv, p.nz * nh, u, 1);
    if (prevA >= 0) {
      if (facingIn) b.quad(prevA, a, c, prevB);
      else b.quad(prevA, prevB, c, a);
    }
    prevA = a;
    prevB = c;
  }
  return b.build();
}

const BOWL = { cx: 0, cz: 52.5, hx: 48, hz: 67, rc: 12, depth: 26, y0: 1.4, y1: 19, roofY: 24, roofIn: 17 };

function crowdTexture(maxAniso: number): THREE.CanvasTexture {
  const W = 2048;
  const H = 1024;
  const { canvas, ctx } = makeCanvas(W, H);
  const rnd = seeded(26);
  ctx.fillStyle = '#141c2b';
  ctx.fillRect(0, 0, W, H);
  // Muted night-time palette with plenty of sky blue and white (home fans).
  const shirts = [
    '#3fc9fc',
    '#2a9fd0',
    '#3fc9fc',
    '#e8eef5',
    '#c9d3de',
    '#e8eef5',
    '#0b1f45',
    '#23335a',
    '#8a1c2c',
    '#b7892a',
    '#5b6472',
    '#2e6b45',
    '#7da7d9',
    '#d9e4ee',
    '#44506a',
  ];
  const skins = ['#5a3a22', '#7a4e33', '#a8703c', '#c79560', '#3b2416', '#d8ae7a'];
  const rowH = 24;
  const pitch = 15;
  // Canvas y = 0 is the top of the texture = back of the stand (v = 1).
  for (let row = 0; row * rowH < H; row++) {
    const y = H - (row + 1) * rowH;
    const depthFade = 1 - (0.35 * (row * rowH)) / H;
    ctx.globalAlpha = 1;
    ctx.fillStyle = row % 2 === 0 ? '#161d2b' : '#121826';
    ctx.fillRect(0, y, W, rowH);
    const shift = (row * 5) % pitch;
    for (let x = -shift; x < W; x += pitch) {
      if (rnd() < 0.07) continue;
      const jx = x + (rnd() - 0.5) * 3;
      const jy = y + 5 + (rnd() - 0.5) * 3;
      ctx.globalAlpha = depthFade * (0.55 + 0.45 * rnd());
      ctx.fillStyle = shirts[Math.floor(rnd() * shirts.length)];
      ctx.fillRect(jx + 1, jy + 7, 12, 12);
      ctx.fillStyle = skins[Math.floor(rnd() * skins.length)];
      ctx.beginPath();
      ctx.arc(jx + 7, jy + 4, 3.8, 0, Math.PI * 2);
      ctx.fill();
      if (rnd() < 0.1) {
        // Raised arm / scarf.
        ctx.fillStyle = rnd() < 0.5 ? '#3fc9fc' : '#e8eef5';
        ctx.fillRect(jx + (rnd() < 0.5 ? 0 : 12), jy - 5, 2.5, 10);
      }
    }
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, maxAniso);
  return tex;
}

function boardTexture(): THREE.CanvasTexture {
  const W = 1024;
  const H = 64;
  const { canvas, ctx } = makeCanvas(W, H);
  ctx.fillStyle = '#000e29';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#3fc9fc';
  ctx.fillRect(0, H - 6, W, 6);
  ctx.textBaseline = 'middle';
  // Two logo + slogan blocks per tile, laid out by measured width so nothing is clipped.
  const blocks: [string, string, string, string][] = [
    ['LT26', '#3fc9fc', 'LUTHER TALILEI 26', '#ffffff'],
    ['LT26', '#ffffff', 'SHOOTING PRACTICE', '#3fc9fc'],
  ];
  const logoFont = 'italic 900 38px system-ui, sans-serif';
  const textFont = '700 24px system-ui, sans-serif';
  const widths = blocks.map(([logo, , text]) => {
    ctx.font = logoFont;
    const a = ctx.measureText(logo).width;
    ctx.font = textFont;
    return a + 18 + ctx.measureText(text).width;
  });
  const gap = (W - widths[0] - widths[1]) / 2;
  let x = gap / 2;
  blocks.forEach(([logo, logoCol, text, textCol], i) => {
    ctx.font = logoFont;
    ctx.fillStyle = logoCol;
    ctx.fillText(logo, x, H / 2 - 2);
    const a = ctx.measureText(logo).width;
    ctx.font = textFont;
    ctx.fillStyle = textCol;
    ctx.fillText(text, x + a + 18, H / 2 - 2);
    x += widths[i] + gap;
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function glowTexture(): THREE.CanvasTexture {
  const n = 128;
  const { canvas, ctx } = makeCanvas(n, n);
  const g = ctx.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,250,225,0.95)');
  g.addColorStop(0.4, 'rgba(255,240,200,0.25)');
  g.addColorStop(1, 'rgba(255,240,200,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, n, n);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function skyDome(): THREE.Mesh {
  const g = new THREE.SphereGeometry(420, 24, 12);
  const pos = g.getAttribute('position');
  const top = new THREE.Color(SKY_TOP);
  const hor = new THREE.Color(SKY_HORIZON);
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, pos.getY(i) / 420));
    c.copy(hor).lerp(top, Math.pow(t, 0.6));
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.Mesh(
    g,
    new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  m.name = 'sky';
  m.renderOrder = -1;
  return m;
}

/** Tower foot positions (outside the bowl corners). */
function towerSites(): { x: number; z: number }[] {
  const ox = BOWL.hx + BOWL.depth - 4;
  const oz = BOWL.hz + BOWL.depth - 4;
  return [
    { x: -ox, z: BOWL.cz - oz },
    { x: ox, z: BOWL.cz - oz },
    { x: -ox, z: BOWL.cz + oz },
    { x: ox, z: BOWL.cz + oz },
  ];
}

const TOWER_H = 46;

function structure(): THREE.BufferGeometry {
  const ring = roundedRing(BOWL.cx, BOWL.cz, BOWL.hx, BOWL.hz, BOWL.rc, 10);
  const parts: THREE.BufferGeometry[] = [];
  // Front wall below the first row.
  parts.push(painted(ringStrip(ring, 0, 0, 0, BOWL.y0, 1, true), 0x0a1628));
  // Back wall between the top row and the roof.
  parts.push(painted(ringStrip(ring, BOWL.depth, BOWL.y1, BOWL.depth, BOWL.roofY, 1, true), 0x0c1424));
  // Roof slab (seen from below), and a sky-blue fascia along its front edge.
  parts.push(
    painted(ringStrip(ring, BOWL.depth + 2, BOWL.roofY, BOWL.depth - BOWL.roofIn, BOWL.roofY, 1, false), 0x0e1320),
  );
  const fIn = BOWL.depth - BOWL.roofIn;
  parts.push(painted(ringStrip(ring, fIn, BOWL.roofY - 1.2, fIn, BOWL.roofY + 0.3, 1, true), 0x3fc9fc));
  // Floodlight towers: pole + head frame.
  for (const t of towerSites()) {
    parts.push(
      painted(cylinderBetween(new THREE.Vector3(t.x, 0, t.z), new THREE.Vector3(t.x, TOWER_H, t.z), 0.6, 8), 0x5b6474),
    );
    const head = new THREE.BoxGeometry(9, 5, 0.8);
    head.lookAt(new THREE.Vector3(-t.x, 0, BOWL.cz - (t.z - BOWL.cz)));
    head.translate(t.x, TOWER_H + 1, t.z);
    parts.push(painted(head, 0x2a3140));
  }
  for (const p of parts) if (p.getAttribute('uv')) p.deleteAttribute('uv');
  return merge(parts);
}

function lampGlows(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const centre = new THREE.Vector3(0, 0, BOWL.cz);
  for (const t of towerSites()) {
    for (const [gx, gy, size] of [
      [0, 0, 24],
      [-2.4, 1, 7],
      [2.4, 1, 7],
      [-2.4, -1.2, 7],
      [2.4, -1.2, 7],
    ] as const) {
      const q = new THREE.PlaneGeometry(size, size);
      const base = new THREE.Vector3(t.x, TOWER_H + 1, t.z);
      const toC = new THREE.Vector3().subVectors(centre, base).setY(0).normalize();
      const right = new THREE.Vector3(-toC.z, 0, toC.x);
      q.lookAt(toC);
      q.translate(base.x + toC.x * 0.8 + right.x * gx, base.y + gy, base.z + toC.z * 0.8 + right.z * gx);
      parts.push(q);
    }
  }
  return merge(parts);
}

export function createStadium(maxAniso: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'stadium';
  group.add(skyDome());

  const ring = roundedRing(BOWL.cx, BOWL.cz, BOWL.hx, BOWL.hz, BOWL.rc, 10);
  const crowd = new THREE.Mesh(
    ringStrip(ring, 0, BOWL.y0, BOWL.depth, BOWL.y1, 64, true),
    new THREE.MeshLambertMaterial({ map: crowdTexture(maxAniso), color: 0xc4cad4 }),
  );
  crowd.name = 'crowd';
  group.add(crowd);

  const struct = new THREE.Mesh(
    structure(),
    new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
  );
  struct.name = 'structure';
  group.add(struct);

  const boardRing = roundedRing(0, 52.5, 42, 59, 6, 6);
  const boards = new THREE.Mesh(
    ringStrip(boardRing, 0, 0, 0, 1.0, 16, true),
    new THREE.MeshBasicMaterial({ map: boardTexture(), color: 0xd8dde6 }),
  );
  boards.name = 'boards';
  group.add(boards);

  const glows = new THREE.Mesh(
    lampGlows(),
    new THREE.MeshBasicMaterial({
      map: glowTexture(),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    }),
  );
  glows.name = 'floodlights';
  glows.renderOrder = 2;
  group.add(glows);
  return group;
}
