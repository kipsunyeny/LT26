// Boot: build the sim, scene, audio and session log, hand them to the UI app (screen router + loop).
import './ui/styles.css';
import type { DebugHook, KickIntent, SceneApi, Settings, SimEvent } from './contracts';
import { createSim } from './sim';
import { createScene } from './render';
import { createAudio } from './audio';
import { createSessionLog } from './data/sessionLog';
import { createApp } from './ui/app';
import { loadSettings } from './data/settings';

function safeStorage(): Storage | null {
  try {
    const k = '__lt26_probe';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return localStorage;
  } catch {
    return null;
  }
}

function boot(): void {
  const storage = safeStorage();
  const settings: Settings = loadSettings(storage);
  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const root = document.getElementById('ui') as HTMLElement;
  const sim = createSim({ settings, seed: Date.now() >>> 0 });
  let scene: SceneApi | null = null;
  try {
    scene = createScene(canvas, {});
  } catch (err) {
    console.warn('WebGL unavailable, running without 3D scene', err);
  }
  const intents: KickIntent[] = [];
  const events: SimEvent[] = [];
  sim.on((e) => {
    events.push(e);
    if (events.length > 500) events.shift();
  });
  const app = createApp(root, { sim, scene, log: createSessionLog(storage), audio: createAudio(), canvas });
  const hook: DebugHook = { sim, scene, intents, events, screen: () => app.screen() };
  (window as unknown as { __lt26: DebugHook }).__lt26 = hook;

  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('SW registration failed', err));
  }
}

boot();
