// Title screen: logo left, mode buttons centre (sky blue), Talilei full-height right, the 3D
// stadium (title camera) dimmed behind, Stats / Settings, and Install when the browser offers it.
import type { Mode } from '../contracts';
import logo512 from '../../assets/brand/logo-512.webp';
import talilei512 from '../../assets/brand/talilei-512.webp';
import talilei1024 from '../../assets/brand/talilei-1024.webp';
import type { Core, ScreenHandle } from './core';
import { button, h } from './dom';

export interface InstallPrompt {
  available(): boolean;
  prompt(): void;
  onChange(cb: () => void): () => void;
}

const MODES: { mode: Mode; label: string; sub: string }[] = [
  { mode: 'freeKick', label: 'Free kick', sub: 'wall · keeper' },
  { mode: 'penalty', label: 'Penalty', sub: 'run-up · keeper' },
  { mode: 'longShot', label: 'Long shot', sub: 'touch · strike' },
];

export function mountTitle(core: Core, install: InstallPrompt): ScreenHandle {
  const modeButtons = MODES.map((m) => {
    const b = h(
      'button',
      { type: 'button', class: 'btn-mode', testid: `btn-mode-${m.mode}` },
      h('span', { class: 'btn-mode-label' }, m.label),
      h('span', { class: 'btn-mode-sub' }, m.sub),
    );
    b.addEventListener('click', () => {
      core.setMode(m.mode);
      core.go('play');
    });
    return b;
  });
  const installBtn = button('Install app', 'btn-install', 'btn-secondary', () => install.prompt());
  const syncInstall = (): void => {
    installBtn.hidden = !install.available();
  };
  syncInstall();
  const off = install.onChange(syncInstall);

  const el = h(
    'section',
    { class: 'screen screen-title', 'data-screen': 'title' },
    h('div', { class: 'title-dim' }),
    h(
      'div',
      { class: 'title-logo-wrap' },
      h('img', { class: 'title-logo', src: logo512, alt: 'LT26 logo', testid: 'title-logo', draggable: 'false' }),
    ),
    h(
      'div',
      { class: 'title-menu' },
      h('h1', { class: 'title-name' }, 'Luther Talilei 26'),
      h('p', { class: 'title-tag' }, 'Realistic shooting practice'),
      ...modeButtons,
      h(
        'div',
        { class: 'title-row' },
        button('My stats', 'btn-stats', 'btn-secondary', () => core.go('stats')),
        button('Settings', 'btn-settings', 'btn-secondary', () => core.go('settings')),
      ),
      installBtn,
    ),
    h('img', {
      class: 'title-talilei',
      src: talilei1024,
      srcset: `${talilei512} 384w, ${talilei1024} 768w`,
      sizes: '36vw',
      alt: 'Talilei, number 10',
      testid: 'talilei',
      draggable: 'false',
    }),
  );
  return { el, destroy: off };
}
