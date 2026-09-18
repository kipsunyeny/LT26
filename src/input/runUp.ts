// Run-up timing helpers shared by both control schemes and the HUD timing indicator.
// The sim is the authority on the actual penalty (docs/ARCHITECTURE.md §2); these helpers
// mirror its rule so the HUD can show the player what a given release timing will cost.

/** Half-width of the "perfect" contact window, ms. */
export const TIMING_WINDOW_MS = 80;
/** Beyond this error the penalty is at its maximum, ms. */
export const TIMING_MAX_ERR_MS = 400;
/** Power multiplier at (and beyond) the maximum error. */
export const TIMING_MIN_POWER = 0.75;
/** Extra aim scatter σ at (and beyond) the maximum error, degrees. */
export const TIMING_MAX_SCATTER_DEG = 3;

/** Signed timing error of a release: negative = early, positive = late. */
export function timingErrorMs(atMs: number, idealContactMs: number): number {
  return atMs - idealContactMs;
}

/** 0 inside the window, rising linearly to 1 at TIMING_MAX_ERR_MS, clamped. */
function penaltyFraction(errMs: number): number {
  const e = Math.abs(errMs);
  if (e <= TIMING_WINDOW_MS) return 0;
  return Math.min(1, (e - TIMING_WINDOW_MS) / (TIMING_MAX_ERR_MS - TIMING_WINDOW_MS));
}

/** Power multiplier for a timing error (1 in the window, falls linearly to 0.75). */
export function timingPowerMultiplier(errMs: number): number {
  return 1 - (1 - TIMING_MIN_POWER) * penaltyFraction(errMs);
}

/** Extra aim scatter σ in degrees for a timing error (0 in the window, up to 3°). */
export function timingScatterDeg(errMs: number): number {
  return TIMING_MAX_SCATTER_DEG * penaltyFraction(errMs);
}

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
