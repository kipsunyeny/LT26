// Shot-data card shown after every kick.
import type { ShotResult, ShotSummary } from '../contracts';
import { formatTiming } from '../input/runUp';
import { h } from './dom';

export function resultLabel(r: ShotResult): string {
  switch (r) {
    case 'goal':
      return 'Goal!';
    case 'saved':
      return 'Saved';
    case 'caught':
      return 'Caught by the keeper';
    case 'post':
      return 'Off the post';
    case 'bar':
      return 'Off the bar';
    case 'wall':
      return 'Blocked by the wall';
    case 'miss':
      return 'Missed';
  }
}

export function crossingLabel(s: ShotSummary): string {
  if (!s.crossing) return 'Did not reach the line';
  const x = s.crossing.x;
  const side = Math.abs(x) < 0.05 ? 'centre' : `${Math.abs(x).toFixed(2)} m ${x < 0 ? 'left' : 'right'}`;
  return `${side}, ${s.crossing.y.toFixed(2)} m high`;
}

export interface ShotCardRow {
  id: string;
  label: string;
  value: string;
}

export function shotCardRows(s: ShotSummary, timingErrMs: number | null): ShotCardRow[] {
  const rows: ShotCardRow[] = [
    { id: 'speed', label: 'Ball speed', value: `${s.speedKmh.toFixed(0)} km/h` },
    { id: 'spin', label: 'Spin', value: `${s.spinRps.toFixed(1)} rev/s` },
    { id: 'curve', label: 'Lateral curve', value: `${s.lateralCurveM.toFixed(2)} m` },
    { id: 'apex', label: 'Apex', value: `${s.apexM.toFixed(2)} m` },
    { id: 'time', label: 'Time to goal', value: `${s.timeToGoalS.toFixed(2)} s` },
    { id: 'crossing', label: 'Crossed the line', value: crossingLabel(s) },
  ];
  if (s.result !== 'goal') rows.push({ id: 'miss', label: 'Missed by', value: `${s.missDistanceM.toFixed(2)} m` });
  if (timingErrMs !== null) rows.push({ id: 'timing', label: 'Strike timing', value: formatTiming(timingErrMs) });
  return rows;
}

export function buildShotCard(
  s: ShotSummary,
  timingErrMs: number | null,
  onNext: () => void,
  onReplay: () => void,
): HTMLElement {
  const next = h('button', { type: 'button', class: 'btn-primary', testid: 'btn-next' }, 'Next kick');
  next.addEventListener('click', onNext);
  const replay = h('button', { type: 'button', class: 'btn-secondary', testid: 'btn-replay' }, 'Replay');
  replay.addEventListener('click', onReplay);
  const dl = h('dl', { class: 'card-data' });
  for (const r of shotCardRows(s, timingErrMs)) {
    dl.append(h('dt', {}, r.label), h('dd', { testid: `shot-${r.id}` }, r.value));
  }
  return h(
    'div',
    { class: `shot-card is-${s.result}`, testid: 'shot-card', role: 'dialog', 'aria-label': 'Shot data' },
    h('div', { class: 'card-result', testid: 'shot-result' }, resultLabel(s.result)),
    dl,
    h('div', { class: 'card-actions' }, replay, next),
  );
}
