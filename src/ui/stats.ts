// Stats screen: per-spot attempts, goals, %, average miss, from the persisted session log.
import type { Mode, SpotStats } from '../contracts';
import type { Core, ScreenHandle } from './core';
import { button, h } from './dom';
import { MODE_LABEL, UI_SPOTS, spotLabel } from './spots';

const MODE_ORDER: Mode[] = ['freeKick', 'penalty', 'longShot'];

export interface StatsRow {
  key: string;
  spot: string;
  mode: string;
  attempts: number;
  goals: number;
  pct: string;
  avgMiss: string;
}

/** Order: by mode, then preset order, then free placements by key. */
export function statsRows(all: readonly SpotStats[]): StatsRow[] {
  const rank = (s: SpotStats): number => {
    const list = UI_SPOTS[s.mode] ?? [];
    const i = list.findIndex((x) => x.key === s.spotKey);
    return MODE_ORDER.indexOf(s.mode) * 1000 + (i < 0 ? 500 : i);
  };
  return [...all]
    .filter((s) => s.attempts > 0)
    .sort((a, b) => rank(a) - rank(b) || a.spotKey.localeCompare(b.spotKey))
    .map((s) => ({
      key: s.spotKey,
      spot: spotLabel(s.spotKey),
      mode: MODE_LABEL[s.mode] ?? s.mode,
      attempts: s.attempts,
      goals: s.goals,
      pct: `${Math.round((100 * s.goals) / s.attempts)} %`,
      avgMiss: s.goals === s.attempts ? '–' : `${s.avgMissM.toFixed(2)} m`,
    }));
}

export function mountStats(core: Core): ScreenHandle {
  const rows = statsRows(core.log.all());
  const body = h('tbody');
  if (rows.length === 0) {
    body.append(h('tr', {}, h('td', { colspan: 6, class: 'stats-empty' }, 'No kicks yet. Take a shot!')));
  }
  for (const r of rows) {
    body.append(
      h(
        'tr',
        { 'data-spot': r.key },
        h('th', { scope: 'row' }, r.spot),
        h('td', {}, r.mode),
        h('td', { class: 'num' }, String(r.attempts)),
        h('td', { class: 'num' }, String(r.goals)),
        h('td', { class: 'num' }, r.pct),
        h('td', { class: 'num' }, r.avgMiss),
      ),
    );
  }
  const table = h(
    'table',
    { class: 'stats-table', testid: 'stats-table' },
    h(
      'thead',
      {},
      h(
        'tr',
        {},
        h('th', { scope: 'col' }, 'Spot'),
        h('th', { scope: 'col' }, 'Mode'),
        h('th', { scope: 'col', class: 'num' }, 'Kicks'),
        h('th', { scope: 'col', class: 'num' }, 'Goals'),
        h('th', { scope: 'col', class: 'num' }, 'Goal %'),
        h('th', { scope: 'col', class: 'num' }, 'Avg miss'),
      ),
    ),
    body,
  );
  const el = h(
    'section',
    { class: 'screen screen-panel', 'data-screen': 'stats' },
    h(
      'div',
      { class: 'panel' },
      h(
        'header',
        { class: 'panel-head' },
        button('Back', 'btn-back', 'btn-secondary', () => core.go(core.previous())),
        h('h2', {}, 'My stats'),
      ),
      h('div', { class: 'table-wrap' }, table),
      h('p', { class: 'panel-note' }, 'Saved on this device. Miss = distance from the goal frame.'),
    ),
  );
  return { el, destroy() {} };
}
