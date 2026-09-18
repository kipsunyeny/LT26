// Free-kick mini-map: a top-down penalty area (SVG units = metres, goal at the top) where the
// ball can be dragged to any spot 16–35 m from the goal centre.
import type { Core } from './core';
import { h, svg } from './dom';

export const MM_VIEW = { x: -22, z: -2, w: 44, h: 40 };
export const FK_MIN_DIST = 16;
export const FK_MAX_DIST = 35;
/** Keep the ball in front of the goal line (m). */
export const FK_MIN_Z = 2;

const validCell = (x: number, z: number): boolean => {
  const d = Math.hypot(x, z);
  return d >= FK_MIN_DIST && d <= FK_MAX_DIST && z >= FK_MIN_Z && Math.abs(x) <= -MM_VIEW.x;
};

/**
 * Clamp a dragged position to the legal free-kick area, then snap to the nearest whole-metre cell
 * that is itself legal (16–35 m from the goal centre, ≥ 2 m out, on the map): spot keys use metres.
 */
export function minimapPlace(x: number, z: number): { x: number; z: number } {
  let px = Math.max(MM_VIEW.x, Math.min(MM_VIEW.x + MM_VIEW.w, x));
  let pz = Math.max(FK_MIN_Z, z);
  const d = Math.hypot(px, pz);
  const target = Math.min(FK_MAX_DIST, Math.max(FK_MIN_DIST, d));
  if (d > 1e-6 && target !== d) {
    px = (px / d) * target;
    pz = (pz / d) * target;
  }
  let best: { x: number; z: number } | null = null;
  let bestD = Infinity;
  for (let r = 1; r <= 4 && !best; r += 1) {
    for (let cx = Math.floor(px) - r + 1; cx <= Math.ceil(px) + r - 1; cx += 1) {
      for (let cz = Math.floor(pz) - r + 1; cz <= Math.ceil(pz) + r - 1; cz += 1) {
        if (!validCell(cx, cz)) continue;
        const e = Math.hypot(cx - px, cz - pz);
        if (e < bestD) {
          bestD = e;
          best = { x: cx === 0 ? 0 : cx, z: cz };
        }
      }
    }
  }
  return best ?? { x: 0, z: FK_MIN_DIST };
}

/** Screen point → minimap metres for an SVG box (preserveAspectRatio xMidYMid meet). */
export function minimapFromScreen(
  sx: number,
  sy: number,
  box: { left: number; top: number; width: number; height: number },
): { x: number; z: number } {
  const scale = Math.min(box.width / MM_VIEW.w, box.height / MM_VIEW.h) || 1;
  const ox = box.left + (box.width - MM_VIEW.w * scale) / 2;
  const oy = box.top + (box.height - MM_VIEW.h * scale) / 2;
  return { x: MM_VIEW.x + (sx - ox) / scale, z: MM_VIEW.z + (sy - oy) / scale };
}

export interface Minimap {
  el: HTMLElement;
  sync(): void;
  destroy(): void;
}

export function buildMinimap(core: Core): Minimap {
  const map = svg('svg', {
    class: 'minimap',
    testid: 'minimap',
    viewBox: `${MM_VIEW.x} ${MM_VIEW.z} ${MM_VIEW.w} ${MM_VIEW.h}`,
    role: 'img',
    'aria-label': 'Ball position: drag to place the free kick',
  });
  const line = (x1: number, y1: number, x2: number, y2: number, cls = 'mm-line'): SVGLineElement =>
    svg('line', { x1, y1, x2, y2, class: cls });
  const rect = (x: number, y: number, w: number, hh: number, cls = 'mm-line'): SVGRectElement =>
    svg('rect', { x, y, width: w, height: hh, class: cls });
  const dx = Math.sqrt(9.15 * 9.15 - 5.5 * 5.5);
  map.append(
    rect(MM_VIEW.x, MM_VIEW.z, MM_VIEW.w, MM_VIEW.h, 'mm-pitch'),
    svg('circle', { cx: 0, cy: 0, r: FK_MAX_DIST, class: 'mm-zone' }),
    svg('circle', { cx: 0, cy: 0, r: FK_MIN_DIST, class: 'mm-zone-inner' }),
    line(MM_VIEW.x, 0, MM_VIEW.x + MM_VIEW.w, 0),
    rect(-20.16, 0, 40.32, 16.5),
    rect(-9.16, 0, 18.32, 5.5),
    rect(-3.66, -1.5, 7.32, 1.5, 'mm-goal'),
    svg('circle', { cx: 0, cy: 11, r: 0.35, class: 'mm-dot' }),
    svg('path', { d: `M ${-dx} 16.5 A 9.15 9.15 0 0 0 ${dx} 16.5`, class: 'mm-line' }),
  );
  const ball = svg('circle', { cx: 0, cy: 22, r: 1.1, class: 'mm-ball' });
  map.append(ball);
  const readout = h('div', { class: 'mm-readout', testid: 'minimap-readout' });
  const el = h('div', { class: 'minimap-wrap' }, h('div', { class: 'panel-label' }, 'Ball position'), map, readout);

  const show = (x: number, z: number): void => {
    ball.setAttribute('cx', String(x));
    ball.setAttribute('cy', String(z));
    const side = Math.abs(x) < 0.5 ? 'centre' : `${Math.round(Math.abs(x))} m ${x < 0 ? 'left' : 'right'}`;
    readout.textContent = `${Math.round(Math.hypot(x, z))} m from goal · ${side}`;
  };
  let dragging = false;
  let pending: { x: number; z: number } | null = null;
  const at = (ev: PointerEvent): { x: number; z: number } => {
    const m = minimapFromScreen(ev.clientX, ev.clientY, map.getBoundingClientRect());
    return minimapPlace(m.x, m.z);
  };
  const onDown = (ev: PointerEvent): void => {
    if (core.sim.state.phase === 'flight' || core.ui.gesture) return;
    dragging = true;
    try {
      map.setPointerCapture(ev.pointerId);
    } catch {
      /* best-effort */
    }
    ev.preventDefault();
    pending = at(ev);
    show(pending.x, pending.z);
  };
  const onMove = (ev: PointerEvent): void => {
    if (!dragging) return;
    pending = at(ev);
    show(pending.x, pending.z);
  };
  const onUp = (): void => {
    if (!dragging) return;
    dragging = false;
    if (pending) core.setSpot(pending);
    pending = null;
  };
  map.addEventListener('pointerdown', onDown);
  map.addEventListener('pointermove', onMove);
  map.addEventListener('pointerup', onUp);
  map.addEventListener('pointercancel', onUp);
  return {
    el,
    sync() {
      if (dragging) return;
      const b = core.sim.state.ballStart;
      show(Math.round(b.x * 10) / 10, Math.round(b.z * 10) / 10);
    },
    destroy() {
      map.removeEventListener('pointerdown', onDown);
      map.removeEventListener('pointermove', onMove);
      map.removeEventListener('pointerup', onUp);
      map.removeEventListener('pointercancel', onUp);
    },
  };
}
