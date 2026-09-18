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
    previewDirty = false;
    const pts = sim.previewPath(previewIntent);
    core.ui.aimPreview = pts.length > 1 ? pts : null;
    scene?.setAimPreview(core.ui.aimPreview);
    previewShown = true;
  };

  const ghostPath = (): Vec3[] | null => log.get(sim.state.spotKey)?.best?.path ?? null;
  let resultGhost: Vec3[] | null = null;
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
  const resetShotUi = (): void => {
    core.ui.runUp = null;
    core.ui.pendingCard = null;
    core.ui.lastTimingErrMs = null;
    core.ui.swipePath = null;
    flightPath = [];
    resultGhost = null;
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
      debugHook()?.intents.push(intent);
      clearAimPreview();
      sim.applyIntent(intent);
    },
    startRunUp() {
      if (core.ui.runUp) return;
      const startMs = sim.state.time * 1000;
      const contact = sim.startRunUp();
      core.ui.runUp = { startMs, contactMs: contact * 1000 };
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
      if (core.ui.pendingCard) scene.setTrail(core.ui.pendingCard.path, resultGhost);
      else scene.setTrail(null, ghostPath());
    },
    ui: {
      disguise: false,
      runUp: null,
      lastIntent: null,
      lastTimingErrMs: null,
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
        resultGhost = log.get(e.summary.spotKey)?.best?.path ?? null;
        log.record(e.summary);
        core.ui.pendingCard = e.summary;
        scene?.setTrail(e.summary.path, resultGhost);
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
    const rendered = handle?.frame?.(dt) === true;
    if (!rendered && scene) scene.render(sim.state.world, dt);
    raf = requestAnimationFrame(loop);
  };

  const onResize = (): void => {
    fallback = null;
    scene?.resize(window.innerWidth, window.innerHeight, Math.min(2, window.devicePixelRatio || 1));
  };
  listen('resize', onResize);
  onResize();

  // --- First gesture: unlock audio; on touch devices go fullscreen + lock landscape. ---
  let unlocked = false;
  const firstGesture = (): void => {
    if (unlocked) return;
    unlocked = true;
    audio.unlock();
    audio.setEnabled(settings.sound);
    void enterLandscape();
  };
  listen('pointerdown', firstGesture, { capture: true });
  listen('keydown', firstGesture, { capture: true });

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
async function enterLandscape(): Promise<void> {
  try {
    const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    if (!coarse || navigator.webdriver || !document.fullscreenEnabled || document.fullscreenElement) return;
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
