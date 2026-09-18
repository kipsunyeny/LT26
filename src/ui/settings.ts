// Settings screen: control scheme, altitude, sound, footedness, reset data (inline confirm).
import type { Settings } from '../contracts';
import type { Core, ScreenHandle } from './core';
import { button, h } from './dom';

function select<K extends keyof Settings>(
  core: Core,
  key: K,
  testid: string,
  label: string,
  options: [Settings[K], string][],
): HTMLElement {
  const id = `set-${String(key)}`;
  const sel = h('select', { id, testid, class: 'select' });
  for (const [v, text] of options) {
    const o = h('option', { value: String(v) }, text);
    if (core.settings()[key] === v) o.selected = true;
    sel.append(o);
  }
  sel.addEventListener('change', () => {
    const found = options.find(([v]) => String(v) === sel.value);
    if (found) core.updateSettings({ [key]: found[0] } as Partial<Settings>);
  });
  return h('div', { class: 'setting' }, h('label', { for: id }, label), sel);
}

export function mountSettings(core: Core): ScreenHandle {
  const sound = h('input', { type: 'checkbox', id: 'set-sound', testid: 'setting-sound', class: 'switch' });
  sound.checked = core.settings().sound;
  sound.addEventListener('change', () => core.updateSettings({ sound: sound.checked }));

  const status = h('p', { class: 'reset-status', role: 'status', testid: 'reset-status' });
  const confirmRow = h(
    'div',
    { class: 'reset-confirm', hidden: true },
    h('span', {}, 'Delete all kick stats and best-kick ghosts?'),
    button('Yes, reset', 'btn-reset-confirm', 'btn-danger', () => {
      core.log.reset();
      confirmRow.hidden = true;
      resetBtn.hidden = false;
      status.textContent = 'All kick data deleted.';
      core.refreshTrail();
    }),
    button('Cancel', 'btn-reset-cancel', 'btn-secondary', () => {
      confirmRow.hidden = true;
      resetBtn.hidden = false;
    }),
  );
  const resetBtn = button('Reset data', 'btn-reset-data', 'btn-secondary', () => {
    confirmRow.hidden = false;
    resetBtn.hidden = true;
    status.textContent = '';
  });

  const el = h(
    'section',
    { class: 'screen screen-panel', 'data-screen': 'settings' },
    h(
      'div',
      { class: 'panel' },
      h(
        'header',
        { class: 'panel-head' },
        button('Back', 'btn-back', 'btn-secondary', () => core.go(core.previous())),
        h('h2', {}, 'Settings'),
      ),
      h(
        'div',
        { class: 'settings-grid' },
        select(core, 'controlScheme', 'setting-scheme', 'Controls', [
          ['swipe', 'Swipe (touch the ball and flick)'],
          ['dial', 'Dial (reticle, power, knobs)'],
        ]),
        select(core, 'altitude', 'setting-altitude', 'Altitude', [
          ['nairobi', 'Nairobi, 1,800 m (thinner air)'],
          ['sea', 'Sea level'],
        ]),
        h('div', { class: 'setting' }, h('label', { for: 'set-sound' }, 'Sound'), sound),
        select(core, 'footed', 'setting-footed', 'Kicking foot', [
          ['right', 'Right-footed'],
          ['left', 'Left-footed'],
        ]),
        h('div', { class: 'setting' }, h('span', { class: 'setting-name' }, 'Kick data'), resetBtn),
        confirmRow,
        status,
      ),
    ),
  );
  return { el, destroy() {} };
}
