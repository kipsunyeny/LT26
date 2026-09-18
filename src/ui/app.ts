// STUB (Phase 0) — replaced by the input & UI engineer.
import type { SceneApi, SessionLog, Sim } from '../contracts';
import type { AudioApi } from '../audio';

export interface AppDeps {
  sim: Sim;
  scene: SceneApi | null;
  log: SessionLog;
  audio: AudioApi;
  canvas: HTMLCanvasElement;
}

export interface App {
  screen(): string;
  destroy(): void;
}

export function createApp(root: HTMLElement, _deps: AppDeps): App {
  root.textContent = 'LT26';
  return { screen: () => 'title', destroy() {} };
}
