import type { BallState, Collider, ContactEvent, Vec3 } from '../contracts';
import {
  BALL_INERTIA_FACTOR,
  BALL_RADIUS,
  GOAL_HALF_WIDTH,
  GOAL_HEIGHT,
  GROUND_MU,
  GROUND_RESTITUTION,
  GROUND_ROLLING_RESISTANCE,
  GROUND_SETTLE_SPEED,
  NET_DAMPING,
  NET_DEPTH,
  NET_RESTITUTION,
  NET_TANGENT_KEEP,
  POST_RADIUS,
  POST_RESTITUTION,
  REST_SPEED,
} from './constants';

/** Result of resolving one contact source for one step. */
export interface CollisionResult {
  state: BallState;
  contact: ContactEvent | null;
}

const R = BALL_RADIUS;
/** Contacts slower than this (normal approach speed, m/s) are resolved silently (no ContactEvent). */
const SILENT_CONTACT_SPEED = 0.5;
/** Swept test: sub-sample the step so the ball never moves more than this fraction of the combined radius. */
const SWEEP_FRACTION = 0.5;
const SWEEP_MAX_SAMPLES = 32;

const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const norm = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);

/**
 * Goal frame for the goal on the plane z = 0: two posts and the crossbar as capsules on their centre lines
 * (x = ±(3.66 + 0.06), y = 2.44 + 0.06), restitution 0.7, plus the net as an absorb box 2.0 m deep behind the
 * line whose side, top and back faces are the side netting, roof and back netting.
 */
export function goalFrameColliders(): Collider[] {
  const cx = GOAL_HALF_WIDTH + POST_RADIUS;
  const cy = GOAL_HEIGHT + POST_RADIUS;
  const outer = GOAL_HALF_WIDTH + 2 * POST_RADIUS;
  return [
    {
      kind: 'capsule',
      tag: 'post',
      a: { x: -cx, y: 0, z: 0 },
      b: { x: -cx, y: cy, z: 0 },
      radius: POST_RADIUS,
      restitution: POST_RESTITUTION,
    },
    {
      kind: 'capsule',
      tag: 'post',
      a: { x: cx, y: 0, z: 0 },
      b: { x: cx, y: cy, z: 0 },
      radius: POST_RADIUS,
      restitution: POST_RESTITUTION,
    },
    {
      kind: 'capsule',
      tag: 'bar',
      a: { x: -cx, y: cy, z: 0 },
      b: { x: cx, y: cy, z: 0 },
      radius: POST_RADIUS,
      restitution: POST_RESTITUTION,
    },
    {
      kind: 'absorbBox',
      tag: 'net',
      min: { x: -outer, y: 0, z: -NET_DEPTH },
      max: { x: outer, y: GOAL_HEIGHT + 2 * POST_RADIUS, z: 0 },
    },
  ];
}

/**
 * Tangential friction impulse at the ground contact point (0, −r, 0), Coulomb-limited.
 * `limit` is the largest allowed tangential Δv (μ × normal Δv). Returns the new v and ω.
 * Slip velocity u = v + ω × (0, −r, 0) = (v.x + r ω.z, 0, v.z − r ω.x). Removing all slip needs
 * Δv = −u / (1 + 1/k) for I = k m r²; the angular response is Δω = (c × Δv) / (k r²).
 */
function groundFriction(v: Vec3, w: Vec3, limit: number): { v: Vec3; w: Vec3 } {
  const ux = v.x + R * w.z;
  const uz = v.z - R * w.x;
  const slip = Math.hypot(ux, uz);
  if (slip === 0) return { v, w };
  const k = BALL_INERTIA_FACTOR;
  let dvx = -ux / (1 + 1 / k);
  let dvz = -uz / (1 + 1 / k);
  const need = Math.hypot(dvx, dvz);
  if (need > limit) {
    dvx *= limit / need;
    dvz *= limit / need;
  }
  return {
    v: { x: v.x + dvx, y: v.y, z: v.z + dvz },
    w: { x: w.x - dvz / (k * R), y: w.y, z: w.z + dvx / (k * R) },
  };
}

/**
 * Ground plane y = 0. After an integration step that left the ball centre below r:
 *  - approaching faster than GROUND_SETTLE_SPEED → bounce: v_y → −e v_y (e = 0.6), penetration reflected,
 *    friction impulse limited to μ (1 + e)|v_y| (sliding ↔ rolling coupling), ContactEvent 'ground';
 *  - otherwise the ball is in resting contact: v_y → 0, friction limited to μ |Δv_y| (the normal impulse of
 *    the step), rolling resistance decelerates by GROUND_ROLLING_RESISTANCE·g, and it stops below REST_SPEED.
 */
export function collideGround(s: BallState, dt: number, g: number): CollisionResult {
  if (s.p.y >= R) return { state: s, contact: null };
  const vy = s.v.y;
  if (vy < -GROUND_SETTLE_SPEED) {
    const dvn = (1 + GROUND_RESTITUTION) * -vy;
    const f = groundFriction({ x: s.v.x, y: -GROUND_RESTITUTION * vy, z: s.v.z }, s.w, GROUND_MU * dvn);
    const state: BallState = {
      t: s.t,
      p: { x: s.p.x, y: R + GROUND_RESTITUTION * (R - s.p.y), z: s.p.z },
      v: f.v,
      w: f.w,
    };
    return {
      state,
      contact: {
        t: s.t,
        tag: 'ground',
        point: { x: s.p.x, y: 0, z: s.p.z },
        speedBefore: norm(s.v),
        colliderIndex: -1,
      },
    };
  }
  const dvn = Math.max(0, -vy);
  const f = groundFriction({ x: s.v.x, y: 0, z: s.v.z }, s.w, GROUND_MU * dvn);
  let v = f.v;
  let w = f.w;
  const vt = Math.hypot(v.x, v.z);
  const decel = GROUND_ROLLING_RESISTANCE * g * dt;
  if (vt <= Math.max(decel, REST_SPEED)) {
    v = { x: 0, y: 0, z: 0 };
    w = { x: 0, y: 0, z: 0 };
  } else {
    const k = 1 - decel / vt;
    v = { x: v.x * k, y: 0, z: v.z * k };
    w = { x: w.x * k, y: w.y, z: w.z * k };
  }
  return { state: { t: s.t, p: { x: s.p.x, y: R, z: s.p.z }, v, w }, contact: null };
}

/** Closest point on segment ab to p. */
function closestOnSegment(p: Vec3, a: Vec3, b: Vec3): Vec3 {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 === 0) return a;
  const u = Math.min(1, Math.max(0, dot(sub(p, a), ab) / l2));
  return add(a, scale(ab, u));
}

/**
 * Sphere/capsule collider: swept along the step (sub-sampled so the ball cannot tunnel), then the velocity
 * RELATIVE to the collider (whose velocity field is `velocity`, default 0) is reflected along the contact
 * normal with the collider's restitution; the tangential relative velocity is kept. Separating contacts are
 * ignored, so an overlapping ball moving away is never pulled back.
 */
function collideRound(
  prev: BallState,
  s: BallState,
  c: Extract<Collider, { kind: 'capsule' | 'sphere' }>,
  index: number,
): CollisionResult {
  const closest = (p: Vec3): Vec3 => (c.kind === 'sphere' ? c.center : closestOnSegment(p, c.a, c.b));
  const reach = c.radius + R;
  const d = sub(s.p, prev.p);
  const n = Math.min(SWEEP_MAX_SAMPLES, Math.max(1, Math.ceil(norm(d) / (SWEEP_FRACTION * reach))));
  for (let k = 1; k <= n; k++) {
    const p = k === n ? s.p : add(prev.p, scale(d, k / n));
    const q = closest(p);
    const off = sub(p, q);
    const dist = norm(off);
    if (dist >= reach) continue;
    const vc = c.velocity ?? { x: 0, y: 0, z: 0 };
    const vrel = sub(s.v, vc);
    const nrm = dist > 1e-12 ? scale(off, 1 / dist) : scale(vrel, -1 / Math.max(norm(vrel), 1e-12));
    const vn = dot(vrel, nrm);
    if (vn >= 0) return { state: s, contact: null };
    const v = add(vc, sub(vrel, scale(nrm, (1 + c.restitution) * vn)));
    const state: BallState = { t: s.t, p: add(q, scale(nrm, reach)), v, w: s.w };
    return {
      state,
      contact: {
        t: s.t,
        tag: c.tag,
        point: add(q, scale(nrm, c.radius)),
        speedBefore: norm(s.v),
        colliderIndex: index,
      },
    };
  }
  return { state: s, contact: null };
}

type Face = { axis: 'x' | 'y' | 'z'; sign: 1 | -1; plane: number };

/** Applies a net-surface hit on one face (outward normal `sign` along `axis`, ball centre put on `plane`). */
function netFace(s: BallState, face: Face, index: number, tag: Collider['tag']): CollisionResult {
  const vn = s.v[face.axis] * face.sign; // > 0: moving into the net surface
  const p = { ...s.p, [face.axis]: face.plane };
  if (vn <= 0) return { state: { ...s, p }, contact: null };
  const v = {
    x: s.v.x * NET_TANGENT_KEEP,
    y: s.v.y * NET_TANGENT_KEEP,
    z: s.v.z * NET_TANGENT_KEEP,
    [face.axis]: -NET_RESTITUTION * s.v[face.axis],
  } as Vec3;
  const w = scale(s.w, NET_TANGENT_KEEP);
  const point = { ...p, [face.axis]: face.plane + face.sign * R } as Vec3;
  const contact: ContactEvent | null =
    vn > SILENT_CONTACT_SPEED ? { t: s.t, tag, point, speedBefore: norm(s.v), colliderIndex: index } : null;
  return { state: { t: s.t, p, v, w }, contact };
}

/**
 * Net volume (axis-aligned box, open at the front face z = max.z). Inside the bag the ball is damped and
 * contained by the side/top/back netting (absorbing: restitution 0.1, 30 % of tangential speed and spin kept),
 * then drops under gravity. From outside, the side netting, roof and back netting are absorbing surfaces the
 * ball cannot pass through.
 */
function collideNet(
  prev: BallState,
  s: BallState,
  c: Extract<Collider, { kind: 'absorbBox' }>,
  index: number,
  dt: number,
): CollisionResult {
  const { min, max } = c;
  const inBag = (p: Vec3): boolean =>
    p.x > min.x && p.x < max.x && p.y >= min.y && p.y < max.y && p.z > min.z && p.z < max.z;
  const enteredFront = prev.p.z >= max.z && s.p.z < max.z && s.p.x > min.x && s.p.x < max.x && s.p.y < max.y;
  if (inBag(prev.p) || enteredFront) {
    const damp = Math.exp(-NET_DAMPING * dt);
    let cur: BallState = { ...s, v: scale(s.v, damp) };
    let contact: ContactEvent | null = null;
    const faces: Face[] = [
      { axis: 'x', sign: -1, plane: min.x + R },
      { axis: 'x', sign: 1, plane: max.x - R },
      { axis: 'y', sign: 1, plane: max.y - R },
      { axis: 'z', sign: -1, plane: min.z + R },
    ];
    for (const f of faces) {
      if ((cur.p[f.axis] - f.plane) * f.sign <= 0) continue;
      const hit = netFace(cur, f, index, c.tag);
      cur = hit.state;
      contact = contact ?? hit.contact;
    }
    return { state: cur, contact };
  }
  // Outside: the box grown by the ball radius on every face but the open front.
  const grown = (p: Vec3): boolean =>
    p.x > min.x - R && p.x < max.x + R && p.y < max.y + R && p.z > min.z - R && p.z < max.z;
  if (!grown(s.p)) return { state: s, contact: null };
  const faces: (Face & { was: boolean; depth: number })[] = [
    { axis: 'x', sign: -1, plane: min.x - R, was: prev.p.x <= min.x - R, depth: s.p.x - (min.x - R) },
    { axis: 'x', sign: 1, plane: max.x + R, was: prev.p.x >= max.x + R, depth: max.x + R - s.p.x },
    { axis: 'y', sign: 1, plane: max.y + R, was: prev.p.y >= max.y + R, depth: max.y + R - s.p.y },
    { axis: 'z', sign: -1, plane: min.z - R, was: prev.p.z <= min.z - R, depth: s.p.z - (min.z - R) },
  ];
  const candidates = faces.some((f) => f.was) ? faces.filter((f) => f.was) : faces;
  const best = candidates.reduce((a, b) => (b.depth < a.depth ? b : a));
  // Outward normal of the chosen face points away from the box: the ball moves "into" it with sign −outward.
  return netFace(s, { axis: best.axis, sign: -best.sign as 1 | -1, plane: best.plane }, index, c.tag);
}

/** Resolves the ball against one collider for the step prev → s. */
export function collideCollider(
  prev: BallState,
  s: BallState,
  c: Collider,
  index: number,
  dt: number,
): CollisionResult {
  if (c.kind === 'absorbBox') return collideNet(prev, s, c, index, dt);
  return collideRound(prev, s, c, index);
}
