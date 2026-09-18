// Shared services the screens use. Created by app.ts.
import type {
  InputPreview,
  KickIntent,
  Mode,
  SceneApi,
  SessionLog,
  Settings,
  ShotSummary,
  Sim,
  Vec3,
} from '../contracts';
import type { AudioApi } from '../audio';
import type { DialScheme } from '../input/dial';
import type { InputScheme } from '../contracts';

export type ScreenName = 'title' | 'play' | 'replay' | 'stats' | 'settings';

export interface ScreenHandle {
  el: HTMLElement;
  /** Per animation frame. Return true if the screen rendered the 3D scene itself. */
  frame?(dt: number): boolean | void;
  destroy(): void;
}

export interface View {
  worldToScreen(p: Vec3): { x: number; y: number; visible: boolean };
  screenToGoalPlane(sx: number, sy: number): { x: number; y: number } | null;
  ballScreen(): { x: number; y: number; r: number };
}

export interface RunUpInfo {
  startMs: number;
  contactMs: number;
}

export interface Core {
  sim: Sim;
  scene: SceneApi | null;
  log: SessionLog;
  audio: AudioApi;
  storage: Storage | null;
  view: View;
  schemes: { swipe: InputScheme; dial: DialScheme };
  settings(): Settings;
  updateSettings(patch: Partial<Settings>): void;
  go(screen: ScreenName): void;
  previous(): ScreenName;
  /** Switch mode (sim + scene) and reset per-shot UI state. */
  setMode(mode: Mode): void;
  setSpot(spot: string | { x: number; z: number }): void;
  /** Push an intent to the debug hook and the sim (adds the penalty disguise flag). */
  emitIntent(intent: KickIntent): void;
  startRunUp(): void;
  /** Abort a run-up that ended without a strike. */
  cancelRunUp(): void;
  preview(p: InputPreview | null): void;
  /** Next kick at the same spot. */
  nextShot(): void;
  /** Re-apply trail/ghost for the current state (aiming: ghost only). */
  refreshTrail(): void;
  ui: {
    disguise: boolean;
    runUp: RunUpInfo | null;
    lastIntent: KickIntent | null;
    lastTimingErrMs: number | null;
    /** Side spin (rev/s) of the last strike's launch, for the inside/outside-of-the-foot label. */
    lastSideSpin: number | null;
    /** Best kick at this spot from BEFORE the last shot was recorded (replay/result ghost). */
    resultGhost: Vec3[] | null;
    /** A kick gesture (swipe / Shoot hold) is in progress: menus, tabs and spots ignore presses. */
    gesture: boolean;
    pendingCard: ShotSummary | null;
    swipePath: { x: number; y: number }[] | null;
    aimPreview: Vec3[] | null;
  };
}
