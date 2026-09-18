// Unified touch/mouse/pen handling on top of Pointer Events: one active pointer at a time,
// captured for the whole gesture, delivered as PointerSample streams in element-independent
// CSS pixels (clientX/clientY — the input layer covers the viewport) and ms timestamps.
import type { PointerSample } from '../contracts';

export interface PointerHandlers {
  /** Return false to ignore this gesture (the pointer is then not captured). */
  down(s: PointerSample, ev: PointerEvent): boolean | void;
  move?(s: PointerSample, ev: PointerEvent): void;
  up?(s: PointerSample, ev: PointerEvent): void;
  cancel?(ev: PointerEvent): void;
}

export interface PointerTrackOptions {
  /** Timestamp source in ms; default ev.timeStamp (high-resolution, monotonic). */
  clock?: (ev: PointerEvent) => number;
}

export function sampleOf(ev: PointerEvent, clock?: (ev: PointerEvent) => number): PointerSample {
  return { x: ev.clientX, y: ev.clientY, t: clock ? clock(ev) : ev.timeStamp };
}

/**
 * Track single-pointer gestures on `el`. Coalesced events are expanded so fast swipes keep
 * their full resolution. Returns a function that removes every listener.
 */
export function trackPointer(el: HTMLElement, h: PointerHandlers, opts: PointerTrackOptions = {}): () => void {
  let active: number | null = null;
  const clock = opts.clock;

  const onDown = (ev: PointerEvent): void => {
    if (active !== null) return;
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    if (h.down(sampleOf(ev, clock), ev) === false) return;
    active = ev.pointerId;
    try {
      el.setPointerCapture(ev.pointerId);
    } catch {
      /* capture is best-effort (synthetic events may not be capturable) */
    }
    ev.preventDefault();
  };
  const onMove = (ev: PointerEvent): void => {
    if (ev.pointerId !== active || !h.move) return;
    const list = typeof ev.getCoalescedEvents === 'function' ? ev.getCoalescedEvents() : [];
    if (list.length > 1) for (const c of list) h.move(sampleOf(c, clock), c);
    else h.move(sampleOf(ev, clock), ev);
  };
  const onUp = (ev: PointerEvent): void => {
    if (ev.pointerId !== active) return;
    active = null;
    h.up?.(sampleOf(ev, clock), ev);
  };
  const onCancel = (ev: PointerEvent): void => {
    if (ev.pointerId !== active) return;
    active = null;
    h.cancel?.(ev);
  };

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onCancel);
  return () => {
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onCancel);
    active = null;
  };
}
