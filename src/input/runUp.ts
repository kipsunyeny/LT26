// Run-up helpers shared by both control schemes and the HUD timing indicator. The power/scatter
// rule for a mistimed strike lives in the sim (sim/kick.ts); the UI only shows where the ideal
// contact is and grades a release.
import type { InputContext } from '../contracts';

/** Half-width of the "perfect" contact window, ms (docs/ARCHITECTURE.md §2). */
export const TIMING_WINDOW_MS = 80;

export type TimingGrade = 'perfect' | 'early' | 'late';

export function timingGrade(errMs: number): TimingGrade {
  if (Math.abs(errMs) <= TIMING_WINDOW_MS) return 'perfect';
  return errMs < 0 ? 'early' : 'late';
}

/**
 * Position of the timing marker on the indicator, 0..1, where 0.75 is the ideal contact.
 * The marker enters at 0 when the run-up starts and keeps moving past the ideal point, so a
 * late release is visible. startMs/contactMs/nowMs are sim-clock milliseconds.
 */
export const TIMING_IDEAL_POS = 0.75;
export function timingMarkerPos(nowMs: number, startMs: number, contactMs: number): number {
  const span = Math.max(1, contactMs - startMs);
  const f = ((nowMs - startMs) / span) * TIMING_IDEAL_POS;
  return Math.min(1, Math.max(0, f));
}

/** Half-width of the perfect window in marker units (for drawing the zone). */
export function timingWindowWidth(startMs: number, contactMs: number): number {
  const span = Math.max(1, contactMs - startMs);
  return (TIMING_WINDOW_MS / span) * TIMING_IDEAL_POS;
}

/** Human label, e.g. "+35 ms · perfect". */
export function formatTiming(errMs: number): string {
  const r = Math.round(errMs);
  const sign = r > 0 ? '+' : r < 0 ? '−' : '±';
  return `${sign}${Math.abs(r)} ms · ${timingGrade(errMs)}`;
}

/** Which gesture a press starts in the given mode/phase, or null if the scheme should ignore it. */
export interface GesturePlan {
  kind: 'strike' | 'push';
  /** Press starts the taker's run-up (release = strike at contact). */
  runUp: boolean;
}

export function gesturePlan(mode: 'freeKick' | 'penalty' | 'longShot', phase: string): GesturePlan | null {
  switch (phase) {
    case 'setup':
    case 'aiming':
      if (mode === 'penalty') return { kind: 'strike', runUp: true };
      if (mode === 'longShot') return { kind: 'push', runUp: false };
      return { kind: 'strike', runUp: false };
    case 'runUp':
      return mode === 'freeKick' ? null : { kind: 'strike', runUp: false };
    case 'pushed':
      return mode === 'longShot' ? { kind: 'strike', runUp: true } : null;
    default:
      return null;
  }
}

/**
 * Optional app-side hooks a scheme may use on top of the contract's InputContext
 * (the app wires them; a bare InputContext still works).
 */
export interface InputContextExtras {
  /** Abort a run-up that did not end in a strike (tap, cancelled pointer). */
  cancelRunUp?(): void;
  /** A gesture is in progress (true on press, false on release/cancel): the HUD ignores menu presses. */
  gesture?(active: boolean): void;
  /** Power for a long-shot tap strike (last dial power, default 0.7). */
  tapPower?(): number;
}

export type AppInputContext = InputContext & InputContextExtras;

export function extras(ctx: InputContext): InputContextExtras {
  return ctx as AppInputContext;
}

/** Release check: the mode must be unchanged and the current phase must still allow this gesture kind. */
export function releaseAllowed(
  plan: GesturePlan,
  modeAtDown: 'freeKick' | 'penalty' | 'longShot',
  modeNow: 'freeKick' | 'penalty' | 'longShot',
  phaseNow: string,
): boolean {
  if (modeAtDown !== modeNow) return false;
  const now = gesturePlan(modeNow, phaseNow);
  return now !== null && now.kind === plan.kind;
}
