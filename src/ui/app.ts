// App: screen router, requestAnimationFrame loop, sim-event wiring (session log, shot card,
// audio, trails), settings persistence, install prompt, first-gesture unlock and landscape lock.
import type {
  DebugHook,
  InputPreview,
  KickIntent,
  Mode,
  Phase,
  SceneApi,
  SessionLog,
  Settings,
  Sim,
  Vec3,
} from '../contracts';
import type { AudioApi } from '../audio';
import { saveSettings } from '../data/settings';
import { createDialScheme, dialIntent } from '../input/dial';
import { createSwipeScheme } from '../input/swipe';
import type { Core, ScreenHandle, ScreenName, View } from './core';
import { h } from './dom';
import { mountPlay } from './hud';
import { createFallbackProjector, type Projector } from './projector';
import { createPreviewCache, previewKey } from './preview';
import { mountReplay } from './replay';
import { mountSettings } from './settings';
import { mountStats } from './stats';
import { mountTitle, type InstallPrompt } from './title';

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

/** Largest frame step fed to the sim (a stalled tab must not fast-forward a kick). */
export const MAX_FRAME_DT = 0.1;
const AIMING: Phase[] = ['setup', 'aiming', 'runUp', 'pushed'];

export function clampDt(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.min(MAX_FRAME_DT, ms / 1000);
}

function safeStorage(): Storage | null {
  try {
    const s = window.localStorage;
    const k = '__lt26_ui_probe';
    s.setItem(k, '1');
    s.removeItem(k);
    return s;
  } catch {
    return null;
  }
}

const debugHook = (): DebugHook | undefined => (window as unknown as { __lt26?: DebugHook }).__lt26;

type Listen = (type: string, fn: (ev: Event) => void, opts?: AddEventListenerOptions) => void;

interface InstallEvent extends Event {
  prompt(): Promise<void>;
}

export function createApp(root: HTMLElement, deps: AppDeps): App {
  const { sim, scene, log, audio } = deps;
  const storage = safeStorage();
  let settings: Settings = { ...sim.state.settings };
  audio.setEnabled(settings.sound);
  const cleanups: (() => void)[] = [];
  const listen: Listen = (type, fn, opts) => {
    window.addEventListener(type, fn, opts);
    cleanups.push(() => window.removeEventListener(type, fn, opts));
  };

  // --- View: the real scene's projection, or a fallback pinhole camera without WebGL. ---
  let fallback: { key: string; proj: Projector } | null = null;
  const proj = (): Projector => {
    const b = sim.state.ballStart;
    const key = `${b.x},${b.z},${window.innerWidth},${window.innerHeight}`;
    if (!fallback || fallback.key !== key) {
      fallback = { key, proj: createFallbackProjector(b, window.innerWidth, window.innerHeight) };
    }
    return fallback.proj;
  };
  const view: View = {
    worldToScreen: (p) => (scene ? scene.worldToScreen(p) : proj().worldToScreen(p)),
    screenToGoalPlane: (x, y) => (scene ? scene.screenToGoalPlane(x, y) : proj().screenToGoalPlane(x, y)),
    ballScreen: () => {
      const p = sim.state.world.ball.p;
      const s = view.worldToScreen(p);
      const r = scene ? scene.ballScreenRadius() : proj().radiusAt(p);
      return { x: s.x, y: s.y, r: Number.isFinite(r) && r > 0 ? r : 8 };
    },
  };

  // --- Preview (aim line / swipe ghost). ---
  let previewIntent: KickIntent | null = null;
  let previewDirty = false;
  let previewShown = false;
  const previewCache = createPreviewCache();
  const clearAimPreview = (): void => {
    scene?.setAimPreview(null);
    core.ui.aimPreview = null;
    previewShown = false;
  };
  const updatePreview = (): void => {
    const aiming = AIMING.includes(sim.state.phase);
    if (!aiming || !previewIntent) {
      if (previewShown) clearAimPreview();
      return;
    }
    if (!previewDirty && previewShown) return;
    const intent = previewIntent;
    const st = sim.state;
    const key = previewKey(
      intent,
      `${st.mode}|${st.spotKey}|${st.ballStart.x},${st.ballStart.z}|${settings.altitude}|${settings.footed}`,
    );
    const pts = previewCache.get(key, () => sim.previewPath(intent), performance.now());
    if (pts === undefined) return; // throttled: stays dirty, retried next frame
    previewDirty = false;
    core.ui.aimPreview = pts.length > 1 ? pts : null;
    scene?.setAimPreview(core.ui.aimPreview);
    previewShown = true;
  };

  const ghostPath = (): Vec3[] | null => log.get(sim.state.spotKey)?.best?.path ?? null;
  let flightPath: Vec3[] = [];
  let trailTick = 0;

  const dial = createDialScheme();
  const swipe = createSwipeScheme({ ballWorld: () => sim.state.world.ball.p });
  const restoreDialPreview = (): void => {
    if (settings.controlScheme === 'dial') {
      previewIntent = dialIntent(dial.state, 'strike', sim.state.time * 1000);
      previewDirty = true;
    }
  };
  let ownRunUp = false;
  const resetShotUi = (): void => {
    ownRunUp = false;
    core.ui.gesture = false;
    core.ui.runUp = null;
    core.ui.pendingCard = null;
    core.ui.lastTimingErrMs = null;
    core.ui.swipePath = null;
    flightPath = [];
    core.ui.resultGhost = null;
  };

  let current: ScreenName = 'title';
  let prev: ScreenName = 'title';
  let handle: ScreenHandle | null = null;
  const install = createInstallPrompt(listen);

  const core: Core = {
    sim,
    scene,
    log,
    audio,
    storage,
    view,
    schemes: { swipe, dial },
    settings: () => settings,
    updateSettings(patch) {
      settings = { ...settings, ...patch };
      sim.setSettings(patch);
      saveSettings(storage, settings);
      if (patch.sound !== undefined) audio.setEnabled(settings.sound);
      if (patch.controlScheme !== undefined) {
        previewIntent = null;
        previewDirty = true;
        restoreDialPreview();
      }
    },
    go(screen) {
      if (screen !== current) prev = current;
      mount(screen);
    },
    previous: () => (prev === current ? 'title' : prev),
    setMode(mode: Mode) {
      sim.setMode(mode);
      scene?.setMode(mode);
      resetShotUi();
      core.refreshTrail();
      previewIntent = null;
      previewDirty = true;
      restoreDialPreview();
    },
    setSpot(spot) {
      sim.setSpot(spot);
      resetShotUi();
      fallback = null;
      core.refreshTrail();
      previewDirty = true;
      restoreDialPreview();
    },
    emitIntent(i) {
      const intent: KickIntent =
        sim.state.mode === 'penalty' && core.ui.disguise && i.kind === 'strike' ? { ...i, disguise: true } : i;
      core.ui.lastIntent = intent;
      core.ui.runUp = null;
      ownRunUp = false;
      debugHook()?.intents.push(intent);
      clearAimPreview();
      sim.applyIntent(intent);
    },
    startRunUp() {
      if (core.ui.runUp) return;
      const startMs = sim.state.time * 1000;
      const contact = sim.startRunUp();
      core.ui.runUp = { startMs, contactMs: contact * 1000 };
      ownRunUp = true;
    },
    cancelRunUp() {
      // Only undo a run-up this UI started (the long-shot run after a push belongs to the sim).
      if (ownRunUp) sim.cancelRunUp();
      ownRunUp = false;
      core.ui.runUp = null;
    },
    preview(p: InputPreview | null) {
      core.ui.swipePath = p?.swipePath ?? null;
      previewIntent = p?.intent ?? null;
      previewDirty = true;
    },
    nextShot() {
      sim.resetShot();
      resetShotUi();
      core.refreshTrail();
      restoreDialPreview();
    },
    refreshTrail() {
      if (!scene) return;
      if (core.ui.pendingCard) scene.setTrail(core.ui.pendingCard.path, core.ui.resultGhost);
      else scene.setTrail(null, ghostPath());
    },
    ui: {
      disguise: false,
      runUp: null,
      lastIntent: null,
      lastTimingErrMs: null,
      lastSideSpin: null,
      resultGhost: null,
      gesture: false,
      pendingCard: null,
      swipePath: null,
      aimPreview: null,
    },
  };

  // --- Sim events: sounds, log, shot card, trails. ---
  const offSim = sim.on((e) => {
    switch (e.type) {
      case 'runUpStart':
        core.ui.runUp = { startMs: e.t * 1000, contactMs: e.contactAt * 1000 };
        break;
      case 'push':
        audio.play('kick', 0.3);
        break;
      case 'kick':
        audio.play('kick', Math.min(1, e.launch.speed / 32));
        core.ui.runUp = null;
        core.ui.lastTimingErrMs = sim.state.mode === 'freeKick' ? null : e.timingErrorMs;
        core.ui.lastSideSpin = e.launch.sideSpin;
        flightPath = [];
        clearAimPreview();
        break;
      case 'contact': {
        const tag = e.contact.tag;
        const k = Math.min(1, e.contact.speedBefore / 30);
        if (tag === 'post' || tag === 'bar') audio.play('post', k);
        else if (tag === 'net') audio.play('net', k);
        else if (tag === 'wall' || tag === 'defender') audio.play('kick', k * 0.5);
        break;
      }
      case 'save':
        audio.play('save', 1);
        break;
      case 'result': {
        core.ui.resultGhost = log.get(e.summary.spotKey)?.best?.path ?? null;
        log.record(e.summary);
        core.ui.pendingCard = e.summary;
        scene?.setTrail(e.summary.path, core.ui.resultGhost);
        audio.play('crowd', e.summary.result === 'goal' ? 1 : 0.35);
        break;
      }
      default:
        break;
    }
  });

  // --- Router. ---
  root.classList.add('lt26');
  const screenHost = h('div', { class: 'screen-host' });
  const rotate = h(
    'div',
    { class: 'rotate-prompt', testid: 'rotate-prompt', role: 'alert' },
    h('div', { class: 'rotate-icon', 'aria-hidden': 'true' }),
    h('p', {}, 'Turn your device sideways to play LT26.'),
  );
  root.replaceChildren(screenHost, rotate);

  function mount(screen: ScreenName): void {
    handle?.destroy();
    handle?.el.remove();
    core.ui.gesture = false;
    current = screen;
    root.dataset.screen = screen;
    if (screen === 'play') {
      scene?.setMode(sim.state.mode);
      scene?.setCamera('kick');
    } else if (screen !== 'replay') {
      scene?.setCamera('title');
      clearAimPreview();
    }
    switch (screen) {
      case 'title':
        handle = mountTitle(core, install);
        break;
      case 'play':
        handle = mountPlay(core);
        restoreDialPreview();
        previewDirty = true;
        break;
      case 'replay':
        handle = mountReplay(core);
        break;
      case 'stats':
        handle = mountStats(core);
        break;
      case 'settings':
        handle = mountSettings(core);
        break;
    }
    screenHost.append(handle.el);
    if (screen === 'play') core.refreshTrail();
  }

  // --- Frame loop. ---
  let last = performance.now();
  let raf = 0;
  const loop = (ts: number): void => {
    const dt = clampDt(ts - last);
    last = ts;
    if (current === 'play') {
      sim.update(dt);
      if (sim.state.phase === 'flight') {
        const p = sim.state.world.ball.p;
        const lp = flightPath[flightPath.length - 1];
        if (!lp || Math.hypot(p.x - lp.x, p.y - lp.y, p.z - lp.z) > 0.05) flightPath.push({ x: p.x, y: p.y, z: p.z });
        trailTick += 1;
        if (scene && trailTick % 2 === 0) scene.setTrail(flightPath, ghostPath());
      }
      updatePreview();
    }
    if (current === 'replay') {
      // The replay screen renders recorded frames itself.
      if (handle?.frame?.(dt) !== true) scene?.render(sim.state.world, dt);
    } else {
      // Render first so the HUD projects the ball/reticle with this frame's camera.
      scene?.render(sim.state.world, dt);
      handle?.frame?.(dt);
    }
    raf = requestAnimationFrame(loop);
  };

  const onResize = (): void => {
    fallback = null;
    scene?.resize(window.innerWidth, window.innerHeight, Math.min(2, window.devicePixelRatio || 1));
  };
  listen('resize', onResize);
  onResize();

  // --- User gestures: unlock/resume audio on every activation-type event (unlock is idempotent and
  // resumes a suspended context); on touch devices try fullscreen + landscape once, on a real activation.
  let triedLandscape = false;
  const onGesture = (ev: Event): void => {
    audio.unlock();
    audio.setEnabled(settings.sound);
    const activation =
      ev.type === 'pointerup' || ev.type === 'touchend' || ev.type === 'click' || ev.type === 'keydown';
    if (!triedLandscape && activation && ev.isTrusted && isCoarsePointer()) {
      triedLandscape = true;
      void enterLandscape();
    }
  };
  for (const t of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) listen(t, onGesture, { capture: true });

  mount('title');
  raf = requestAnimationFrame(loop);

  return {
    screen: () => current,
    destroy() {
      cancelAnimationFrame(raf);
      offSim();
      handle?.destroy();
      handle?.el.remove();
      for (const c of cleanups) c();
    },
  };
}

/** Fullscreen + landscape lock where supported; every failure is expected and ignored. */
function isCoarsePointer(): boolean {
  try {
    return window.matchMedia?.('(pointer: coarse)').matches ?? false;
  } catch {
    return false;
  }
}

async function enterLandscape(): Promise<void> {
  try {
    if (navigator.webdriver || !document.fullscreenEnabled || document.fullscreenElement) return;
    await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    await o.lock?.('landscape');
  } catch {
    /* not supported (iOS Safari, desktop) or refused: the rotate prompt covers portrait */
  }
}

function createInstallPrompt(listen: Listen): InstallPrompt {
  let deferred: InstallEvent | null = null;
  const subs = new Set<() => void>();
  const notify = (): void => subs.forEach((f) => f());
  listen('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallEvent;
    notify();
  });
  listen('appinstalled', () => {
    deferred = null;
    notify();
  });
  return {
    available: () => deferred !== null,
    prompt() {
      const d = deferred;
      if (!d) return;
      deferred = null;
      notify();
      d.prompt().catch(() => undefined);
    },
    onChange(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}
