// Scheme B — Dial. Numeric, repeatable controls: a reticle dragged on (and beyond) the goal face,
// a power bar that fills and empties while held (released to set power; a quick tap sets the
// tapped value directly), two knobs (curve ±10 rev/s, dip ±6 rev/s) and a Shoot button.
// Penalty / long-shot strike: hold Shoot to run up, release to strike.
// Keyboard: Space = Shoot (hold for the run-up), arrows move the reticle (Shift = 0.5 m steps).
import type { InputContext, InputScheme, KickIntent, Settings } from '../contracts';
import { trackPointer } from './pointer';
import { extras, gesturePlan, releaseAllowed, type GesturePlan } from './runUp';

export interface KnobSpec {
  min: number;
  max: number;
  step: number;
  /** CSS px of drag per unit of value. */
  pxPerUnit: number;
}

export const KNOB_CURVE: KnobSpec = { min: -10, max: 10, step: 0.5, pxPerUnit: 10 };
export const KNOB_DIP: KnobSpec = { min: -6, max: 6, step: 0.5, pxPerUnit: 16 };
/** One full fill-and-empty cycle of the held power bar, ms. */
export const POWER_PERIOD_MS = 1600;
/** A press shorter than this without moving is a tap (sets the tapped power directly). */
export const POWER_TAP_MS = 180;
/** Reticle limits on the goal plane (m): far enough beyond the frame for a mis-aim. */
export const AIM_X_LIMIT = 12;
export const AIM_Y_MAX = 6;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export function snap(v: number, step: number): number {
  const r = Math.round(v / step) * step;
  return Object.is(r, -0) ? 0 : Number(r.toFixed(6));
}

export function clampKnob(v: number, spec: KnobSpec): number {
  return clamp(snap(v, spec.step), spec.min, spec.max);
}

/** Knob value after a drag from `start`: up and right increase. */
export function knobDragValue(start: number, dx: number, dy: number, spec: KnobSpec): number {
  return clampKnob(start + (dx - dy) / spec.pxPerUnit, spec);
}

/** Triangle wave 0 → 1 → 0 over POWER_PERIOD_MS (the held power bar). */
export function powerOscillation(elapsedMs: number, periodMs = POWER_PERIOD_MS): number {
  const p = (((elapsedMs % periodMs) + periodMs) % periodMs) / periodMs;
  return p < 0.5 ? 2 * p : 2 - 2 * p;
}

export function clampAim(t: { x: number; y: number }): { x: number; y: number } {
  return { x: clamp(t.x, -AIM_X_LIMIT, AIM_X_LIMIT), y: clamp(t.y, 0, AIM_Y_MAX) };
}

/**
 * "Inside/outside of the foot" label for a side spin. Physics sign never changes (+ curves right);
 * a right-footer curls it left (negative) with the inside of the foot, a left-footer right.
 */
export function curveLabel(sideSpin: number, footed: Settings['footed']): string {
  if (sideSpin === 0) return 'straight';
  const inside = footed === 'right' ? sideSpin < 0 : sideSpin > 0;
  return `${inside ? 'inside' : 'outside'} · curls ${sideSpin < 0 ? 'left' : 'right'}`;
}

export function dipLabel(topSpin: number): string {
  if (topSpin === 0) return 'no spin';
  return topSpin > 0 ? 'top spin · dips' : 'back spin · floats';
}

export interface DialState {
  target: { x: number; y: number };
  power: number;
  sideSpin: number;
  topSpin: number;
}

export function dialIntent(s: DialState, kind: 'strike' | 'push', atMs: number): KickIntent {
  return {
    kind,
    scheme: 'dial',
    aim: { kind: 'target', x: s.target.x, y: s.target.y },
    power: clamp(s.power, 0, 1),
    sideSpin: clamp(s.sideSpin, KNOB_CURVE.min, KNOB_CURVE.max),
    topSpin: clamp(s.topSpin, KNOB_DIP.min, KNOB_DIP.max),
    atMs,
  };
}

const fmt = (v: number, digits = 1): string => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}`;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  attrs: Record<string, string> = {},
  text = '',
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  n.className = cls;
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text) n.textContent = text;
  return n;
}

export interface DialScheme extends InputScheme {
  /** Called once per animation frame by the app (power oscillation, reticle tracking). */
  frame(): void;
  readonly state: DialState;
}

export function createDialScheme(initial?: Partial<DialState>): DialScheme {
  const state: DialState = {
    target: initial?.target ?? { x: 0, y: 1.5 },
    power: initial?.power ?? 0.7,
    sideSpin: initial?.sideSpin ?? 0,
    topSpin: initial?.topSpin ?? 0,
  };
  let cleanup: (() => void)[] = [];
  let ctxRef: InputContext | null = null;
  let root: HTMLElement | null = null;
  let reticle: HTMLElement | null = null;
  let powerHold: { t0: number } | null = null;
  let refresh: () => void = () => undefined;

  const scheme: DialScheme = {
    id: 'dial',
    state,
    attach(host, ctx) {
      scheme.detach();
      ctxRef = ctx;
      const ui = el('div', 'dial');
      root = ui;
      const ret = el('div', 'reticle', { 'data-testid': 'reticle', role: 'img', 'aria-label': 'Aim reticle' });
      reticle = ret;
      const aimOut = el('div', 'dial-aim', { 'data-testid': 'dial-aim-value' });

      // Power bar.
      const powerBox = el('div', 'dial-box dial-power');
      const powerLabel = el('div', 'dial-label', {}, 'Power');
      const bar = el('div', 'power-bar', {
        'data-testid': 'power-bar',
        role: 'slider',
        tabindex: '0',
        'aria-label': 'Power',
        'aria-valuemin': '0',
        'aria-valuemax': '100',
      });
      const fill = el('div', 'power-fill');
      const mark = el('div', 'power-mark');
      bar.append(fill, mark);
      const powerOut = el('div', 'dial-value', { 'data-testid': 'dial-power-value' });
      powerBox.append(powerLabel, bar, powerOut, aimOut);

      // Knobs.
      const makeKnob = (id: string, name: string, spec: KnobSpec, get: () => number, set: (v: number) => void) => {
        const box = el('div', 'knob', {
          'data-testid': id,
          role: 'slider',
          tabindex: '0',
          'aria-label': name,
          'aria-valuemin': String(spec.min),
          'aria-valuemax': String(spec.max),
        });
        const dial = el('div', 'knob-dial');
        const needle = el('div', 'knob-needle');
        dial.append(needle);
        const value = el('div', 'knob-value', { 'data-testid': `${id}-value` });
        const label = el('div', 'knob-label');
        box.append(dial, value, label);
        let start = 0;
        let s0 = { x: 0, y: 0 };
        cleanup.push(
          trackPointer(box, {
            down(s) {
              start = get();
              s0 = s;
            },
            move(s) {
              set(knobDragValue(start, s.x - s0.x, s.y - s0.y, spec));
              refresh();
            },
          }),
        );
        const onKey = (ev: KeyboardEvent): void => {
          const k = ev.key;
          let v = get();
          if (k === 'ArrowUp' || k === 'ArrowRight') v += spec.step;
          else if (k === 'ArrowDown' || k === 'ArrowLeft') v -= spec.step;
          else if (k === 'Home' || k === '0') v = 0;
          else return;
          ev.preventDefault();
          ev.stopPropagation();
          set(clampKnob(v, spec));
          refresh();
        };
        const onDbl = (): void => {
          set(0);
          refresh();
        };
        box.addEventListener('keydown', onKey);
        box.addEventListener('dblclick', onDbl);
        return { box, needle, value, label, spec, get };
      };
      const curve = makeKnob(
        'knob-curve',
        'Curve',
        KNOB_CURVE,
        () => state.sideSpin,
        (v) => (state.sideSpin = v),
      );
      const dip = makeKnob(
        'knob-dip',
        'Dip',
        KNOB_DIP,
        () => state.topSpin,
        (v) => (state.topSpin = v),
      );
      const knobs = el('div', 'dial-box dial-knobs');
      knobs.append(curve.box, dip.box);

      const shoot = el('button', 'btn-shoot', { 'data-testid': 'btn-shoot', type: 'button' }, 'Shoot');
      const panel = el('div', 'dial-panel');
      const knobsRow = el('div', 'dial-knobs-row');
      knobsRow.append(knobs, shoot);
      panel.append(powerBox, knobsRow);
      ui.append(ret, panel);
      host.append(ui);

      const emitPreview = (): void => ctx.preview({ intent: dialIntent(state, 'strike', ctx.now()) });

      refresh = () => {
        const pct = Math.round(state.power * 100);
        fill.style.transform = `scaleX(${state.power})`;
        mark.style.left = `${pct}%`;
        bar.setAttribute('aria-valuenow', String(pct));
        powerOut.textContent = `${pct} % · ${Math.round(40 + 75 * state.power)} km/h`;
        for (const k of [curve, dip]) {
          const v = k.get();
          k.needle.style.transform = `rotate(${(v / k.spec.max) * 135}deg)`;
          k.value.textContent = `${fmt(v)} rev/s`;
          k.box.setAttribute('aria-valuenow', String(v));
        }
        // Main label + a detail part that compact layouts hide (full text stays in the DOM).
        const setLabel = (n: HTMLElement, text: string): void => {
          const i = text.indexOf(' · ', text.indexOf(' · ') + 3);
          const extra = el('span', 'knob-extra', {}, i < 0 ? '' : text.slice(i));
          n.replaceChildren(i < 0 ? text : text.slice(0, i), extra);
          n.title = text;
        };
        setLabel(curve.label, `Curve · ${curveLabel(state.sideSpin, ctx.settings().footed)}`);
        setLabel(dip.label, `Dip · ${dipLabel(state.topSpin)}`);
        aimOut.textContent = `Aim x ${fmt(state.target.x, 2)} m · height ${state.target.y.toFixed(2)} m`;
        emitPreview();
      };

      // Reticle drag: press anywhere on the free play area (or on the reticle) and drag.
      let grab = { x: 0, y: 0 };
      const setAimFromScreen = (x: number, y: number): void => {
        const g = ctx.screenToGoalPlane(x, y);
        if (!g) return;
        state.target = clampAim(g);
        refresh();
      };
      cleanup.push(
        trackPointer(host, {
          down(s, ev) {
            const t = ev.target as Node | null;
            if (t !== host && t !== ui && t !== ret) return false;
            if (t === ret) {
              const r = ret.getBoundingClientRect();
              grab = { x: s.x - (r.left + r.width / 2), y: s.y - (r.top + r.height / 2) };
            } else grab = { x: 0, y: 0 };
            setAimFromScreen(s.x - grab.x, s.y - grab.y);
            return true;
          },
          move(s) {
            setAimFromScreen(s.x - grab.x, s.y - grab.y);
          },
        }),
      );

      // Power bar: hold = oscillate, release = set; quick tap = tapped value.
      let tap = { t: 0, x: 0, moved: false };
      let powerBefore = state.power;
      cleanup.push(
        trackPointer(
          bar,
          {
            down(s) {
              powerHold = { t0: s.t };
              powerBefore = state.power;
              tap = { t: s.t, x: s.x, moved: false };
              state.power = 0;
              refresh();
            },
            move(s) {
              if (Math.abs(s.x - tap.x) > 6) tap.moved = true;
            },
            up(s) {
              const held = s.t - tap.t;
              if (held < POWER_TAP_MS && !tap.moved) {
                const r = bar.getBoundingClientRect();
                state.power = clamp((s.x - r.left) / Math.max(1, r.width), 0, 1);
              } else {
                state.power = powerOscillation(held);
              }
              state.power = snap(state.power, 0.01);
              powerHold = null;
              refresh();
            },
            cancel() {
              // Interrupted press (system gesture, palm): keep the power the player had set.
              powerHold = null;
              state.power = powerBefore;
              refresh();
            },
          },
          { clock: () => performance.now() },
        ),
      );
      const onBarKey = (ev: KeyboardEvent): void => {
        const up = ev.key === 'ArrowUp' || ev.key === 'ArrowRight';
        const down = ev.key === 'ArrowDown' || ev.key === 'ArrowLeft';
        if (!up && !down) return;
        const d = up ? 0.01 : -0.01;
        ev.preventDefault();
        ev.stopPropagation();
        state.power = snap(clamp(state.power + d, 0, 1), 0.01);
        refresh();
      };
      bar.addEventListener('keydown', onBarKey);

      // Shoot: press (run-up where the mode has one), release = strike / push.
      const ex = extras(ctx);
      let plan: GesturePlan | null = null;
      let modeAtDown = ctx.mode();
      let ranUp = false;
      const press = (): void => {
        if (plan) return;
        modeAtDown = ctx.mode();
        plan = gesturePlan(modeAtDown, ctx.phase());
        if (!plan) return;
        shoot.classList.add('is-held');
        ex.gesture?.(true);
        ranUp = plan.runUp;
        if (plan.runUp) ctx.startRunUp();
      };
      const finish = (): { plan: GesturePlan | null; ranUp: boolean } => {
        const out = { plan, ranUp };
        plan = null;
        ranUp = false;
        shoot.classList.remove('is-held');
        ex.gesture?.(false);
        return out;
      };
      const release = (): void => {
        if (!plan) return;
        const f = finish();
        const p = f.plan as GesturePlan;
        if (!releaseAllowed(p, modeAtDown, ctx.mode(), ctx.phase())) {
          if (f.ranUp) ex.cancelRunUp?.();
          return;
        }
        ctx.preview(null);
        ctx.emitIntent(dialIntent(state, p.kind, ctx.now()));
      };
      const abort = (): void => {
        if (!plan) return;
        if (finish().ranUp) ex.cancelRunUp?.();
      };
      cleanup.push(
        trackPointer(shoot, {
          down: () => press(),
          up: () => release(),
          cancel: () => abort(),
        }),
      );
      cleanup.push(() => abort());
      const typing = (t: EventTarget | null): boolean =>
        t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
      const onKeyDown = (ev: KeyboardEvent): void => {
        if (typing(ev.target) || ev.defaultPrevented) return;
        if (ev.code === 'Space') {
          ev.preventDefault();
          if (!ev.repeat) press();
          return;
        }
        const step = ev.shiftKey ? 0.5 : 0.1;
        const t = { ...state.target };
        if (ev.key === 'ArrowLeft') t.x -= step;
        else if (ev.key === 'ArrowRight') t.x += step;
        else if (ev.key === 'ArrowUp') t.y += step;
        else if (ev.key === 'ArrowDown') t.y -= step;
        else return;
        ev.preventDefault();
        state.target = clampAim({ x: snap(t.x, 0.01), y: snap(t.y, 0.01) });
        refresh();
      };
      const onKeyUp = (ev: KeyboardEvent): void => {
        if (ev.code === 'Space' && !typing(ev.target)) {
          ev.preventDefault();
          release();
        }
      };
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      cleanup.push(() => {
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        bar.removeEventListener('keydown', onBarKey);
      });

      refresh();
      scheme.frame();
    },
    frame() {
      const ctx = ctxRef;
      if (!ctx || !root || !reticle) return;
      if (powerHold) {
        state.power = powerOscillation(performance.now() - powerHold.t0);
        const pct = Math.round(state.power * 100);
        const fill = root.querySelector<HTMLElement>('.power-fill');
        const mark = root.querySelector<HTMLElement>('.power-mark');
        if (fill) fill.style.transform = `scaleX(${state.power})`;
        if (mark) mark.style.left = `${pct}%`;
      }
      const p = ctx.worldToScreen({ x: state.target.x, y: state.target.y, z: 0 });
      reticle.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
      reticle.style.visibility = p.visible ? 'visible' : 'hidden';
    },
    detach() {
      for (const c of cleanup) c();
      cleanup = [];
      root?.remove();
      root = null;
      reticle = null;
      ctxRef = null;
      powerHold = null;
    },
  };
  return scheme;
}
