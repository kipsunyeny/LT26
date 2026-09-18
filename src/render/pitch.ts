// Pitch: striped grass plane (canvas texture) + all markings merged into one white mesh.
import * as THREE from 'three';
import { GeoBuilder, makeCanvas, seeded } from './geom';

export const PITCH = {
  halfWidth: 34,
  length: 105,
  /** Grass extends beyond the lines to the advertising boards. */
  grassMinX: -46,
  grassMaxX: 46,
  grassMinZ: -12,
  grassMaxZ: 117,
  stripe: 5.5,
  line: 0.12,
} as const;

const LINE_Y = 0.012;

function grassTexture(maxAniso: number): THREE.CanvasTexture {
  // One tile = two mowing stripes (2 × 5.5 m) along z, with fine noise.
  const size = 512;
  const { canvas, ctx } = makeCanvas(size, size);
  const light = [74, 140, 64];
  const dark = [63, 124, 55];
  const img = ctx.createImageData(size, size);
  const rnd = seeded(2601);
  for (let y = 0; y < size; y++) {
    const base = y < size / 2 ? light : dark;
    for (let x = 0; x < size; x++) {
      const n = (rnd() - 0.5) * 14;
      const blade = ((x * 7 + y * 3) % 5) - 2;
      const i = (y * size + x) * 4;
      img.data[i] = base[0] + n + blade;
      img.data[i + 1] = base[1] + n * 1.2 + blade;
      img.data[i + 2] = base[2] + n * 0.8;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, maxAniso);
  return tex;
}

function grassMesh(maxAniso: number): THREE.Mesh {
  const w = PITCH.grassMaxX - PITCH.grassMinX;
  const l = PITCH.grassMaxZ - PITCH.grassMinZ;
  const g = new THREE.PlaneGeometry(w, l, 1, 1);
  g.rotateX(-Math.PI / 2);
  g.translate((PITCH.grassMinX + PITCH.grassMaxX) / 2, 0, (PITCH.grassMinZ + PITCH.grassMaxZ) / 2);
  // World-space UVs: one texture tile per 2 stripes, stripe edges on multiples of 5.5 m from the goal line.
  const pos = g.getAttribute('position');
  const uv = g.getAttribute('uv');
  const tile = PITCH.stripe * 2;
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, pos.getX(i) / tile, -pos.getZ(i) / tile);
  }
  uv.needsUpdate = true;
  const mat = new THREE.MeshLambertMaterial({ map: grassTexture(maxAniso) });
  const m = new THREE.Mesh(g, mat);
  m.name = 'grass';
  return m;
}

/** Markings for one half. zGoal = goal line z, dir = +1 if the field runs towards +z from it. */
function endMarkings(b: GeoBuilder, zGoal: number, dir: 1 | -1): void {
  const w = PITCH.line;
  const Z = (d: number) => zGoal + dir * d;
  // Goal line (centred on the line so it matches the posts' diameter).
  b.groundSegment(-PITCH.halfWidth, Z(0), PITCH.halfWidth, Z(0), w, LINE_Y);
  // Goal area (6-yard box): 5.5 m from the inside of each post, 5.5 m deep.
  const ga = 3.66 + 5.5;
  b.groundSegment(-ga, Z(0), -ga, Z(5.5), w, LINE_Y);
  b.groundSegment(ga, Z(0), ga, Z(5.5), w, LINE_Y);
  b.groundSegment(-ga, Z(5.5), ga, Z(5.5), w, LINE_Y);
  // Penalty area: 16.5 m from the inside of each post, 16.5 m deep.
  const pa = 3.66 + 16.5;
  b.groundSegment(-pa, Z(0), -pa, Z(16.5), w, LINE_Y);
  b.groundSegment(pa, Z(0), pa, Z(16.5), w, LINE_Y);
  b.groundSegment(-pa, Z(16.5), pa, Z(16.5), w, LINE_Y);
  // Penalty spot at 11 m and the "D": 9.15 m arc around it, outside the penalty area only.
  b.groundDisc(0, Z(11), 0.12, LINE_Y, 20);
  const half = Math.acos((16.5 - 11) / 9.15);
  const mid = dir === 1 ? Math.PI / 2 : -Math.PI / 2;
  b.groundArc(0, Z(11), 9.15, mid - half, mid + half, w, LINE_Y, 40);
  // Corner arcs, radius 1 m.
  // Angles are measured from +x towards +z; each quarter lies inside the field.
  const quarters: Record<string, [number, number]> = {
    '1,1': [Math.PI / 2, Math.PI],
    '-1,1': [0, Math.PI / 2],
    '1,-1': [Math.PI, 1.5 * Math.PI],
    '-1,-1': [1.5 * Math.PI, 2 * Math.PI],
  };
  for (const sx of [-1, 1] as const) {
    const [a0, a1] = quarters[`${sx},${dir}`];
    b.groundArc(sx * PITCH.halfWidth, Z(0), 1, a0, a1, w, LINE_Y, 8);
  }
}

function markingsGeometry(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const w = PITCH.line;
  const L = PITCH.length;
  endMarkings(b, 0, 1);
  endMarkings(b, L, -1);
  // Touchlines, halfway line, centre circle and spot.
  b.groundSegment(-PITCH.halfWidth, 0, -PITCH.halfWidth, L, w, LINE_Y);
  b.groundSegment(PITCH.halfWidth, 0, PITCH.halfWidth, L, w, LINE_Y);
  b.groundSegment(-PITCH.halfWidth, L / 2, PITCH.halfWidth, L / 2, w, LINE_Y);
  b.groundArc(0, L / 2, 9.15, 0, 2 * Math.PI, w, LINE_Y, 72);
  b.groundDisc(0, L / 2, 0.15, LINE_Y, 16);
  return b.build();
}

export function createPitch(maxAniso: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'pitch';
  group.add(grassMesh(maxAniso));
  const lines = new THREE.Mesh(
    markingsGeometry(),
    new THREE.MeshLambertMaterial({
      color: 0xf4f7f4,
      emissive: 0x2a2d2a,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  );
  lines.name = 'markings';
  group.add(lines);
  return group;
}
