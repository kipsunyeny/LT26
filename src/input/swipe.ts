// Scheme A — Swipe. Pure gesture maths (swipeToIntent and helpers) plus the DOM scheme.
//
// Mapping (brief §3):
//   direction  → azimuth, via the screen images of 1 m of pitch towards the goal centre and 1 m to
//                the kicker's right at the ball, so an up-screen swipe aims at the goal centre and a
//                sideways swipe is read as a direction on the grass, not on the glass;
//   speed      → power: finger speed at release 0.3–2.5 m/s → 40–115 km/h with an ease-in curve;
//                CSS px are converted to metres at 96 CSS px per inch (the CSS reference pixel);
//   curvature  → side spin: signed area between the path and its chord / chord², ±10 rev/s;
//                the ball curves the way the swipe hooks: a swipe that hooks right ⇒ sideSpin > 0;
//   start on the ball (top / centre / bottom) → elevation and top/back spin
//                (top = driven, low, top spin; bottom = lofted, back spin).
import type { InputScheme, KickIntent, PointerSample, Vec3 } from '../contracts';
import { trackPointer } from './pointer';
import { extras, gesturePlan, releaseAllowed, type GesturePlan } from './runUp';

/** CSS reference pixel density (desktop monitors, mouse). */
export const CSS_PX_PER_INCH = 96;
/** Touch tablets/phones lay out more CSS px per physical inch (tablets ≈132–160): used on coarse pointers. */
export const CSS_PX_PER_INCH_COARSE = 150;
export const CSS_PX_PER_METRE = CSS_PX_PER_INCH / 0.0254;
export const CSS_PX_PER_METRE_COARSE = CSS_PX_PER_INCH_COARSE / 0.0254;

/** CSS px per metre of finger travel for a fine (mouse) or coarse (touch) primary pointer. */
export function pxPerMetreFor(coarse: boolean): number {
  return coarse ? CSS_PX_PER_METRE_COARSE : CSS_PX_PER_METRE;
}
export const FINGER_MIN_MPS = 0.3;
export const FINGER_MAX_MPS = 2.5;
/** Exponent of the ease-in power curve (power = f^k, f = normalised finger speed). */
export const POWER_EASE_EXP = 1.6;
/** Finger speed is measured over the last part of the swipe (release speed). */
export const SPEED_WINDOW_MS = 80;
/** Shorter swipes are taps and produce no kick. */
export const MIN_SWIPE_PX = 24;
/** Curvature (area / chord²) below which the swipe counts as straight. */
export const CURVE_DEAD = 0.01;
/** Curvature giving full side spin: a circular arc whose sagitta is ≈18 % of its chord. */
export const CURVE_FULL = 0.12;
export const MAX_SIDE_SPIN = 10;
/** Start offsets within ±this many CSS px of the ball centre count as a centre contact. */
export const CONTACT_DEAD_PX = 10;
/** The top/bottom of the ball is read over at least ±40 CSS px (small balls are hard to hit exactly). */
export const CONTACT_BAND_MIN_PX = 40;
export const MAX_TOP_SPIN = 5;
export const MAX_BACK_SPIN = 5;
/** Launch elevation for a top / centre / bottom contact, degrees. */
export const ELEV_TOP_DEG = 2;
export const ELEV_CENTRE_DEG = 11;
export const ELEV_BOTTOM_DEG = 20;
/** Swipes more than this far off the goal direction (after projection) are rejected. */
export const MAX_REL_AZIMUTH_DEG = 80;

export interface ScreenPoint {
  x: number;
  y: number;
}

/** Screen images (CSS px) of 1 m along the pitch towards the goal centre and 1 m to the right. */
export interface ScreenBasis {
  forward: ScreenPoint;
  right: ScreenPoint;
  /** World azimuth of the ball → goal-centre direction. */
  baseAzimuth: number;
}

export const IDENTITY_BASIS: ScreenBasis = { forward: { x: 0, y: -1 }, right: { x: 1, y: 0 }, baseAzimuth: 0 };

export interface SwipeOptions {
  atMs: number;
  kind?: 'strike' | 'push';
  basis?: ScreenBasis;
  /** CSS px per metre of finger travel (default 96 px/in). */
  pxPerMetre?: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Normalised ease-in power for a finger speed in m/s: 0 at ≤0.3 m/s, 1 at ≥2.5 m/s. */
export function powerFromFingerSpeed(mps: number): number {
  const f = clamp((mps - FINGER_MIN_MPS) / (FINGER_MAX_MPS - FINGER_MIN_MPS), 0, 1);
  return Math.pow(f, POWER_EASE_EXP);
}

export function speedKmhFromPower(power: number): number {
  return 40 + 75 * clamp(power, 0, 1);
}

/** Release speed in CSS px per ms, measured over the last SPEED_WINDOW_MS of the path. */
export function releaseSpeedPxPerMs(path: readonly PointerSample[]): number {
  if (path.length < 2) return 0;
  const end = path[path.length - 1];
  let i = path.length - 1;
  let len = 0;
  while (i > 0) {
    const a = path[i - 1];
    const b = path[i];
    len += Math.hypot(b.x - a.x, b.y - a.y);
    i -= 1;
    if (end.t - path[i].t >= SPEED_WINDOW_MS) break;
  }
  const dt = end.t - path[i].t;
  return dt > 0 ? len / dt : 0;
}

/** Finger speed at release in m/s. */
export function releaseSpeedMps(path: readonly PointerSample[], pxPerMetre = CSS_PX_PER_METRE): number {
  return (releaseSpeedPxPerMs(path) * 1000) / pxPerMetre;
}

/**
 * Signed area between the path and its chord, divided by chord² (dimensionless).
 * Positive when the path bows to the RIGHT of its chord (screen right when travelling along the
 * chord), i.e. the swipe hooks LEFT at its end; negative when it bows left / hooks right.
 */
export function signedCurvature(path: readonly ScreenPoint[]): number {
  if (path.length < 3) return 0;
  const s = path[0];
  const e = path[path.length - 1];
  const cx = e.x - s.x;
  const cy = e.y - s.y;
  const L = Math.hypot(cx, cy);
  if (L < 1e-6) return 0;
  const ux = cx / L;
  const uy = cy / L;
  // Right-hand normal of the chord in screen coordinates (y down): heading up (0,-1) → right (1,0).
  const nx = -uy;
  const ny = ux;
  let area = 0;
  let prevU = 0;
  let prevH = 0;
  for (let i = 1; i < path.length; i += 1) {
    const qx = path[i].x - s.x;
    const qy = path[i].y - s.y;
    const u = qx * ux + qy * uy;
    const h = qx * nx + qy * ny;
    area += ((prevH + h) / 2) * (u - prevU);
    prevU = u;
    prevH = h;
  }
  return area / (L * L);
}

/** Side spin (rev/s) from the swipe's curvature: hooks right ⇒ positive (curves to +x). */
export function sideSpinFromPath(path: readonly ScreenPoint[]): number {
  const k = signedCurvature(path);
  const mag = clamp((Math.abs(k) - CURVE_DEAD) / (CURVE_FULL - CURVE_DEAD), 0, 1);
  // Bowing right of the chord (k > 0) means the path turns left ⇒ ball curves left (negative).
  return mag === 0 ? 0 : -Math.sign(k) * MAX_SIDE_SPIN * mag;
}

/** Half-height (CSS px) of the band read as top…bottom of the ball: max(40 px, the 2.2 r ring). */
export function contactBandPx(ballR: number): number {
  return Math.max(CONTACT_BAND_MIN_PX, 2.2 * ballR);
}

/** Vertical contact on the ball from the swipe start: −1 = top, 0 = centre, +1 = bottom. */
export function contactFromStart(start: ScreenPoint, ball: { x: number; y: number; r: number }): number {
  const dy = start.y - ball.y;
  const band = contactBandPx(ball.r);
  const m = clamp((Math.abs(dy) - CONTACT_DEAD_PX) / (band - CONTACT_DEAD_PX), 0, 1);
  return m === 0 ? 0 : Math.sign(dy) * m;
}

/** Launch elevation (rad) for a contact offset. */
export function elevationFromContact(o: number): number {
  const c = clamp(o, -1, 1);
  const deg =
    c < 0
      ? ELEV_CENTRE_DEG + (ELEV_CENTRE_DEG - ELEV_TOP_DEG) * c
      : ELEV_CENTRE_DEG + (ELEV_BOTTOM_DEG - ELEV_CENTRE_DEG) * c;
  return (deg * Math.PI) / 180;
}

/** Top (+) / back (−) spin in rev/s for a contact offset: top of the ball → top spin. */
export function topSpinFromContact(o: number): number {
  const c = clamp(o, -1, 1);
  if (c === 0) return 0;
  return c < 0 ? -MAX_TOP_SPIN * c : -MAX_BACK_SPIN * c;
}

/** Relative azimuth (rad) of a screen direction, 0 = straight up the screen, + = kicker's right. */
export function relativeAzimuth(d: ScreenPoint, basis: ScreenBasis): number | null {
  const { forward: f, right: r } = basis;
  const det = f.x * r.y - f.y * r.x;
  if (Math.abs(det) < 1e-9) return null;
  const toGround = (v: ScreenPoint): number => {
    const a = (v.x * r.y - v.y * r.x) / det;
    const b = (f.x * v.y - f.y * v.x) / det;
    return Math.atan2(b, a);
  };
  let rel = toGround(d) - toGround({ x: 0, y: -1 });
  while (rel > Math.PI) rel -= 2 * Math.PI;
  while (rel < -Math.PI) rel += 2 * Math.PI;
  return rel;
}

/** Build a screen basis at the ball from a world→screen projection (null if degenerate). */
export function basisFromProjection(
  ball: Vec3,
  worldToScreen: (p: Vec3) => { x: number; y: number; visible: boolean },
): ScreenBasis | null {
  const len = Math.hypot(ball.x, ball.z);
  if (len < 1e-3) return null;
  const fx = -ball.x / len;
  const fz = -ball.z / len;
  const baseAzimuth = Math.atan2(fx, -fz);
  const rx = Math.cos(baseAzimuth);
  const rz = Math.sin(baseAzimuth);
  const p0 = worldToScreen(ball);
  const pf = worldToScreen({ x: ball.x + fx, y: ball.y, z: ball.z + fz });
  const pr = worldToScreen({ x: ball.x + rx, y: ball.y, z: ball.z + rz });
  if (!p0.visible || !pf.visible || !pr.visible) return null;
  const basis: ScreenBasis = {
    forward: { x: pf.x - p0.x, y: pf.y - p0.y },
    right: { x: pr.x - p0.x, y: pr.y - p0.y },
    baseAzimuth,
  };
  const det = basis.forward.x * basis.right.y - basis.forward.y * basis.right.x;
  return Math.abs(det) > 1e-6 && Number.isFinite(det) ? basis : null;
}

/** Map a completed swipe to a KickIntent, or null for taps, backwards or off-direction swipes. */
export function swipeToIntent(
  path: readonly PointerSample[],
  ball: { x: number; y: number; r: number },
  opts: SwipeOptions,
): KickIntent | null {
  if (path.length < 2) return null;
  const s = path[0];
  const e = path[path.length - 1];
  const d = { x: e.x - s.x, y: e.y - s.y };
  if (Math.hypot(d.x, d.y) < MIN_SWIPE_PX) return null;
  const basis = opts.basis ?? IDENTITY_BASIS;
  const rel = relativeAzimuth(d, basis);
  if (rel === null || Math.abs(rel) > (MAX_REL_AZIMUTH_DEG * Math.PI) / 180) return null;
  const contact = contactFromStart(s, ball);
  const power = powerFromFingerSpeed(releaseSpeedMps(path, opts.pxPerMetre ?? CSS_PX_PER_METRE));
  return {
    kind: opts.kind ?? 'strike',
    scheme: 'swipe',
    aim: { kind: 'angles', azimuth: basis.baseAzimuth + rel, elevation: elevationFromContact(contact) },
    power,
    sideSpin: sideSpinFromPath(path),
    topSpin: topSpinFromContact(contact),
    atMs: opts.atMs,
  };
}

/** How far from the ball centre (CSS px) a swipe may start and still count as "on or near" it. */
export function swipeStartRadius(ballR: number): number {
  return Math.max(4 * ballR, 120);
}

/** Long shot, ball rolling: a tap on the ball strikes it towards the goal centre with no spin. */
export function tapStrikeIntent(basis: ScreenBasis | undefined, power: number, atMs: number): KickIntent {
  return {
    kind: 'strike',
    scheme: 'swipe',
    aim: { kind: 'angles', azimuth: (basis ?? IDENTITY_BASIS).baseAzimuth, elevation: elevationFromContact(0) },
    power: clamp(power, 0, 1),
    sideSpin: 0,
    topSpin: 0,
    atMs,
  };
}

export interface SwipeSchemeOptions {
  /** Ball centre in world space, so the swipe direction is read on the pitch. */
  ballWorld?: () => Vec3;
  /** Override the CSS px per inch used for finger speed (default: 150 on coarse pointers, else 96). */
  pxPerInch?: number;
}

function coarsePointer(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

export function createSwipeScheme(opts: SwipeSchemeOptions = {}): InputScheme {
  let off: (() => void) | null = null;
  return {
    id: 'swipe',
    attach(el, ctx) {
      off?.();
      const ex = extras(ctx);
      const pxPerMetre = opts.pxPerInch ? opts.pxPerInch / 0.0254 : pxPerMetreFor(coarsePointer());
      let path: PointerSample[] = [];
      let plan: GesturePlan | null = null;
      let modeAtDown = ctx.mode();
      let ranUp = false;
      let ball = { x: 0, y: 0, r: 1 };
      let basis: ScreenBasis | undefined;
      const build = (): KickIntent | null =>
        plan ? swipeToIntent(path, ball, { atMs: ctx.now(), kind: plan.kind, basis, pxPerMetre }) : null;
      const end = (): void => {
        plan = null;
        path = [];
        ranUp = false;
        ctx.preview(null);
        ex.gesture?.(false);
      };
      off = trackPointer(el, {
        down(s) {
          modeAtDown = ctx.mode();
          const p = gesturePlan(modeAtDown, ctx.phase());
          if (!p) return false;
          ball = ctx.ballScreen();
          if (Math.hypot(s.x - ball.x, s.y - ball.y) > swipeStartRadius(ball.r)) return false;
          plan = p;
          const bw = opts.ballWorld?.();
          basis = (bw && basisFromProjection(bw, (q) => ctx.worldToScreen(q))) || undefined;
          path = [s];
          ex.gesture?.(true);
          if (p.runUp) {
            ctx.startRunUp();
            ranUp = true;
          }
          ctx.preview({ swipePath: [{ x: s.x, y: s.y }] });
          return true;
        },
        move(s) {
          if (!plan) return;
          path.push(s);
          const intent = build();
          ctx.preview({ swipePath: path.map((p) => ({ x: p.x, y: p.y })), intent: intent ?? undefined });
        },
        up(s) {
          if (!plan) return;
          const p = plan;
          const last = path[path.length - 1];
          // Only keep the release sample if the finger moved: a stationary lift-off would dilute the speed.
          if (Math.hypot(s.x - last.x, s.y - last.y) > 0.5) path.push(s);
          const mode = ctx.mode();
          let intent: KickIntent | null = null;
          if (releaseAllowed(p, modeAtDown, mode, ctx.phase())) {
            intent = build();
            const moved = Math.hypot(s.x - path[0].x, s.y - path[0].y);
            if (!intent && mode === 'longShot' && p.kind === 'strike' && moved < MIN_SWIPE_PX) {
              intent = tapStrikeIntent(basis, ex.tapPower?.() ?? 0.7, ctx.now());
            }
          }
          const hadRunUp = ranUp;
          end();
          if (intent) ctx.emitIntent(intent);
          else if (hadRunUp) ex.cancelRunUp?.();
        },
        cancel() {
          const hadRunUp = ranUp;
          end();
          if (hadRunUp) ex.cancelRunUp?.();
        },
      });
    },
    detach() {
      off?.();
      off = null;
    },
  };
}
