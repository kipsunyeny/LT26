// Play screen HUD: mode tabs / back, hint line, logo badge, per-mode set-up panel (mini-map and
// spot presets, penalty disguise), the active control scheme on a full-screen input layer, the
// swipe ghost arrow, the run-up timing indicator and the shot card.
// Layout rule: the bottom-left ≈30 % × 45 % of the screen stays free (the 3D Talilei stands there).
import type { Mode, Phase } from '../contracts';
import { curveLabel } from '../input/dial';
import type { AppInputContext } from '../input/runUp';
import { TIMING_IDEAL_POS, timingMarkerPos, timingWindowWidth } from '../input/runUp';
import logo160 from '../../assets/brand/logo-160.webp';
import type { Core, ScreenHandle } from './core';
import { button, h, svg } from './dom';
import { buildMinimap, type Minimap } from './minimap';
import { buildShotCard } from './shotCard';
import { MODE_LABEL, UI_SPOTS } from './spots';

const MODES: Mode[] = ['freeKick', 'penalty', 'longShot'];
const AIMING: Phase[] = ['setup', 'aiming', 'runUp', 'pushed'];

export function hintFor(mode: Mode, phase: Phase, scheme: 'swipe' | 'dial'): string {
  if (phase === 'flight') return 'Ball in flight…';
  if (phase === 'result') return 'Next kick, or watch the replay.';
  if (scheme === 'swipe') {
    if (mode === 'freeKick')
      return 'Swipe from the ball towards goal · hook the swipe to bend it · start low on the ball to lift it over the wall';
    if (mode === 'penalty')
      return 'Touch the ball to start the run-up · swipe and lift off as he reaches the ball · the keeper reads your body';
    return phase === 'pushed' || phase === 'runUp'
      ? 'Swipe again to strike the rolling ball as you reach it'
      : 'Swipe gently to push the ball forward';
  }
  if (mode === 'freeKick') return 'Drag the reticle · hold the power bar and release · set curve and dip · Shoot';
  if (mode === 'penalty') return 'Set aim, power and spin · hold Shoot to run up · release at the ball';
  return phase === 'pushed' || phase === 'runUp'
    ? 'Hold Shoot to run onto the ball · release as you reach it'
    : 'Shoot to push the ball forward, then strike it';
}

const fmt = (v: number): string => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}`;

export function mountPlay(core: Core): ScreenHandle {
  const { sim } = core;
  /** Menu/tab/spot presses are ignored while a kick gesture is in progress. */
  const guard =
    (fn: () => void): (() => void) =>
    () => {
      if (!core.ui.gesture) fn();
    };
  const layer = h('div', { class: 'input-layer', testid: 'input-layer' });
  const ring = h('div', { class: 'ball-ring', 'aria-hidden': 'true' });

  // Ghost arrow (swipe) and fallback aim preview (only drawn when there is no 3D scene).
  const ghost = svg('svg', { class: 'ghost', 'aria-hidden': 'true' });
  const swipeLine = svg('polyline', { class: 'ghost-swipe', testid: 'ghost-arrow' });
  const swipeHead = svg('polygon', { class: 'ghost-head' });
  const aimLine = svg('polyline', { class: 'ghost-aim' });
  ghost.append(aimLine, swipeLine, swipeHead);

  // Top bar.
  const tabs = MODES.map((m) => {
    const b = button(
      MODE_LABEL[m],
      `tab-${m}`,
      'tab',
      guard(() => {
        if (sim.state.mode === m) return;
        core.setMode(m);
        frame();
      }),
    );
    b.setAttribute('role', 'tab');
    return b;
  });
  const back = button(
    '‹ Menu',
    'btn-back',
    'btn-secondary btn-back',
    guard(() => core.go('title')),
  );
  const hint = h('div', { class: 'hint', testid: 'hint', role: 'status' });
  const lastIntent = h('div', { class: 'last-intent', testid: 'last-intent' });
  const top = h(
    'header',
    { class: 'hud-top' },
    h('nav', { class: 'hud-nav' }, back, h('div', { class: 'tabs', role: 'tablist' }, ...tabs)),
    h('div', { class: 'hud-center' }, hint, lastIntent),
  );
  const logo = h('img', { class: 'hud-logo', src: logo160, alt: 'LT26', testid: 'hud-logo', draggable: 'false' });

  // Timing indicator.
  const tZone = h('div', { class: 'timing-zone' });
  const tMark = h('div', { class: 'timing-mark' });
  const tIdeal = h('div', { class: 'timing-ideal' });
  const timing = h(
    'div',
    { class: 'timing', testid: 'timing', hidden: true },
    h('div', { class: 'panel-label' }, 'Strike timing'),
    h('div', { class: 'timing-track' }, tZone, tIdeal, tMark),
  );
  tIdeal.style.left = `${TIMING_IDEAL_POS * 100}%`;

  // Side panel (per mode).
  const side = h('aside', { class: 'hud-side' });
  let minimap: Minimap | null = null;
  const spotButtons: HTMLButtonElement[] = [];
  let disguiseBtn: HTMLButtonElement | null = null;
  function rebuildPanel(): void {
    minimap?.destroy();
    minimap = null;
    spotButtons.length = 0;
    disguiseBtn = null;
    side.replaceChildren();
    const mode = sim.state.mode;
    if (mode === 'freeKick') {
      minimap = buildMinimap(core);
      side.append(minimap.el);
    }
    const spots = UI_SPOTS[mode];
    if (spots.length > 1) {
      const grid = h('div', { class: 'spot-grid' });
      for (const s of spots) {
        const b = button(
          s.short,
          `spot-${s.key}`,
          'spot',
          guard(() => {
            core.setSpot(s.key);
            syncPanel();
          }),
        );
        b.title = s.label;
        spotButtons.push(b);
        grid.append(b);
      }
      side.append(grid);
    }
    if (mode === 'penalty') {
      const b = button(
        'Disguise: off',
        'toggle-disguise',
        'toggle',
        guard(() => {
          core.ui.disguise = !core.ui.disguise;
          syncDisguise();
        }),
      );
      disguiseBtn = b;
      side.append(
        h('div', { class: 'panel-label' }, 'Body shape'),
        b,
        h('p', { class: 'panel-note' }, 'Open body, strike across: fools the keeper’s read.'),
      );
      syncDisguise();
    }
    side.hidden = side.childElementCount === 0;
    syncPanel();
  }
  function syncDisguise(): void {
    if (!disguiseBtn) return;
    disguiseBtn.textContent = `Disguise: ${core.ui.disguise ? 'on' : 'off'}`;
    disguiseBtn.setAttribute('aria-pressed', String(core.ui.disguise));
  }
  function syncPanel(): void {
    const key = sim.state.spotKey;
    for (const b of spotButtons) {
      const on = b.dataset.testid === `spot-${key}`;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', String(on));
    }
    minimap?.sync();
    tabs.forEach((t, i) => {
      const on = MODES[i] === sim.state.mode;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', String(on));
    });
  }

  const cardHolder = h('div', { class: 'card-holder' });
  const el = h(
    'section',
    { class: 'screen screen-play', 'data-screen': 'play', testid: 'hud' },
    layer,
    ghost,
    ring,
    top,
    logo,
    side,
    timing,
    cardHolder,
  );

  // Input scheme.
  const ctx: AppInputContext = {
    mode: () => sim.state.mode,
    phase: () => sim.state.phase,
    settings: () => core.settings(),
    ballScreen: () => core.view.ballScreen(),
    screenToGoalPlane: (x, y) => core.view.screenToGoalPlane(x, y),
    worldToScreen: (p) => core.view.worldToScreen(p),
    now: () => sim.state.time * 1000,
    emitIntent: (i) => core.emitIntent(i),
    startRunUp: () => core.startRunUp(),
    preview: (p) => core.preview(p),
    cancelRunUp: () => core.cancelRunUp(),
    gesture: (on) => {
      core.ui.gesture = on;
    },
    tapPower: () => core.schemes.dial.state.power,
  };
  let schemeId = core.settings().controlScheme;
  let scheme = core.schemes[schemeId];
  scheme.attach(layer, ctx);
  layer.dataset.scheme = schemeId;

  core.refreshTrail();

  let lastPhase: Phase | null = null;
  let lastSpot = '';
  let lastMode: Mode | null = null;
  let cardFor: unknown = null;
  let lastIntentKey = '';

  function frame(): void {
    const st = sim.state;
    if (core.settings().controlScheme !== schemeId) {
      scheme.detach();
      schemeId = core.settings().controlScheme;
      scheme = core.schemes[schemeId];
      scheme.attach(layer, ctx);
      layer.dataset.scheme = schemeId;
      lastPhase = null;
    }
    if (st.mode !== lastMode) {
      lastMode = st.mode;
      rebuildPanel();
      lastPhase = null;
    }
    if (st.spotKey !== lastSpot) {
      lastSpot = st.spotKey;
      syncPanel();
    }
    if (st.phase !== lastPhase) {
      lastPhase = st.phase;
      hint.textContent = hintFor(st.mode, st.phase, schemeId);
      el.dataset.phase = st.phase;
    }
    const footed = core.settings().footed;
    if (el.dataset.footed !== footed) {
      el.dataset.footed = footed;
      lastIntentKey = '';
    }
    if (schemeId === 'dial') core.schemes.dial.frame();

    // Ball marker (also exposes the ball's screen position for tests and tools).
    const b = core.view.ballScreen();
    layer.dataset.ballX = b.x.toFixed(1);
    layer.dataset.ballY = b.y.toFixed(1);
    layer.dataset.ballR = b.r.toFixed(1);
    const showRing = schemeId === 'swipe' && AIMING.includes(st.phase);
    ring.hidden = !showRing;
    if (showRing) {
      const r = Math.max(b.r * 2.2, 26);
      ring.style.width = ring.style.height = `${2 * r}px`;
      ring.style.transform = `translate(${b.x - r}px, ${b.y - r}px)`;
    }

    // Ghost arrow.
    const sp = core.ui.swipePath;
    if (sp && sp.length > 1) {
      swipeLine.setAttribute('points', sp.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '));
      const e = sp[sp.length - 1];
      const a = sp[Math.max(0, sp.length - 4)];
      const ang = Math.atan2(e.y - a.y, e.x - a.x);
      const L = 18;
      const W = 10;
      const pts = [
        [e.x + Math.cos(ang) * 6, e.y + Math.sin(ang) * 6],
        [e.x - Math.cos(ang) * L + Math.sin(ang) * W, e.y - Math.sin(ang) * L - Math.cos(ang) * W],
        [e.x - Math.cos(ang) * L - Math.sin(ang) * W, e.y - Math.sin(ang) * L + Math.cos(ang) * W],
      ];
      swipeHead.setAttribute('points', pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' '));
      ghost.classList.add('is-swiping');
    } else {
      ghost.classList.remove('is-swiping');
    }
    const ap = core.scene ? null : core.ui.aimPreview;
    if (ap && ap.length > 1) {
      const pts: string[] = [];
      for (const p of ap) {
        const s = core.view.worldToScreen(p);
        if (s.visible) pts.push(`${s.x.toFixed(1)},${s.y.toFixed(1)}`);
      }
      aimLine.setAttribute('points', pts.join(' '));
    } else aimLine.setAttribute('points', '');

    // Last input readout.
    const li = core.ui.lastIntent;
    if (li && `${footed}` + JSON.stringify(li) !== lastIntentKey) {
      lastIntentKey = `${footed}` + JSON.stringify(li);
      const aim =
        li.aim.kind === 'target'
          ? `aim ${fmt(li.aim.x)} m, ${li.aim.y.toFixed(1)} m`
          : `dir ${fmt((li.aim.azimuth * 180) / Math.PI)}°, lift ${((li.aim.elevation * 180) / Math.PI).toFixed(0)}°`;
      const foot = li.kind === 'strike' ? ` (${curveLabel(li.sideSpin, footed)})` : '';
      lastIntent.textContent = `Last ${li.kind}: ${Math.round(40 + 75 * li.power)} km/h · curve ${fmt(li.sideSpin)}${foot} · dip ${fmt(li.topSpin)} rev/s · ${aim}`;
    }

    // Run-up timing.
    const ru = core.ui.runUp;
    const showTiming = ru !== null && AIMING.includes(st.phase);
    timing.hidden = !showTiming;
    if (ru && showTiming) {
      const w = timingWindowWidth(ru.startMs, ru.contactMs);
      tZone.style.left = `${(TIMING_IDEAL_POS - w) * 100}%`;
      tZone.style.width = `${2 * w * 100}%`;
      tMark.style.left = `${timingMarkerPos(st.time * 1000, ru.startMs, ru.contactMs) * 100}%`;
    }

    // Shot card.
    const card = core.ui.pendingCard;
    if (card !== cardFor) {
      cardFor = card;
      cardHolder.replaceChildren();
      if (card) {
        cardHolder.append(
          buildShotCard(
            card,
            core.ui.lastTimingErrMs,
            core.ui.lastSideSpin === null ? null : curveLabel(core.ui.lastSideSpin, core.settings().footed),
            () => core.nextShot(),
            () => core.go('replay'),
          ),
        );
      }
    }
  }

  // Initial sync, so the HUD is complete before the first animation frame (slow devices).
  frame();

  return {
    el,
    frame() {
      frame();
    },
    destroy() {
      scheme.detach();
      minimap?.destroy();
      core.preview(null);
    },
  };
}
