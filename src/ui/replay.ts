// Replay screen: plays the recorded WorldSnapshots (never a re-simulation) at slow motion
// through the replay camera, with the flight path and the best-kick ghost drawn.
import type { Vec3 } from '../contracts';
import type { Core, ScreenHandle } from './core';
import { button, h, svg } from './dom';
import { resultLabel } from './shotCard';

export const REPLAY_SPEED = 0.35;
export const RECORDING_FPS = 60;

/** Frame index for a replay that has been playing for elapsedS of wall time. */
export function replayFrameIndex(
  elapsedS: number,
  frameCount: number,
  speed = REPLAY_SPEED,
  fps = RECORDING_FPS,
): number {
  if (frameCount <= 0) return -1;
  return Math.min(frameCount - 1, Math.max(0, Math.floor(elapsedS * speed * fps)));
}

/** Side view (distance to goal vs height) of a path in a w×h box: polyline points + goal frame. */
export function sideView(
  path: readonly Vec3[],
  w: number,
  h: number,
): { points: string; goalX: number; goalTop: number } {
  const zMax = Math.max(1, ...path.map((p) => p.z));
  const zMin = Math.min(-0.5, ...path.map((p) => p.z));
  const yMax = Math.max(3, ...path.map((p) => p.y));
  const sx = (z: number): number => ((zMax - z) / (zMax - zMin)) * w;
  const sy = (y: number): number => h - (y / yMax) * h;
  const points = path.map((p) => `${sx(p.z).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');
  return { points, goalX: sx(0), goalTop: sy(2.44) };
}

export function mountReplay(core: Core): ScreenHandle {
  const rec = core.sim.state.lastRecording;
  const frames = rec?.frames ?? [];
  let elapsed = 0;
  const progress = h('div', { class: 'replay-progress-fill' });
  const again = button('Replay again', 'btn-replay-again', 'btn-primary', () => {
    elapsed = 0;
  });
  const back = button('Back', 'btn-back', 'btn-secondary', () => core.go('play'));
  const pathSvg = svg('svg', { class: 'replay-side', viewBox: '0 0 240 80', 'aria-hidden': 'true' });
  const line = svg('polyline', { class: 'replay-side-path', testid: 'replay-path' });
  const goal = svg('rect', { class: 'replay-side-goal', x: 0, y: 0, width: 0, height: 0 });
  pathSvg.append(goal, line);
  if (rec) {
    const v = sideView(rec.summary.path, 240, 80);
    line.setAttribute('points', v.points);
    goal.setAttribute('x', v.goalX.toFixed(1));
    goal.setAttribute('y', v.goalTop.toFixed(1));
    goal.setAttribute('width', '4');
    goal.setAttribute('height', (80 - v.goalTop).toFixed(1));
  }

  const info = rec
    ? h(
        'div',
        { class: 'replay-info' },
        h('strong', {}, resultLabel(rec.summary.result)),
        h('span', {}, ` · ${rec.summary.speedKmh.toFixed(0)} km/h · ${rec.summary.spinRps.toFixed(1)} rev/s`),
      )
    : h('div', { class: 'replay-info' }, 'No kick recorded yet.');

  const el = h(
    'section',
    { class: 'screen screen-replay', 'data-screen': 'replay', testid: 'replay' },
    h('header', { class: 'replay-bar' }, back, h('span', { class: 'replay-badge' }, `Replay ${REPLAY_SPEED}×`), info),
    h('div', { class: 'replay-panel' }, pathSvg, h('div', { class: 'replay-progress' }, progress), again),
  );

  const scene = core.scene;
  if (scene && rec) {
    scene.setCamera('replay');
    scene.setAimPreview(null);
    scene.setTrail(rec.summary.path, core.log.get(rec.spotKey)?.best?.path ?? null);
  }

  return {
    el,
    frame(dt) {
      if (frames.length === 0) return false;
      elapsed += dt;
      const i = replayFrameIndex(elapsed, frames.length);
      progress.style.transform = `scaleX(${(i + 1) / frames.length})`;
      el.classList.toggle('is-done', i >= frames.length - 1);
      if (!scene) return false;
      scene.render(frames[i], dt * REPLAY_SPEED);
      return true;
    },
    destroy() {
      scene?.setCamera('kick');
    },
  };
}
