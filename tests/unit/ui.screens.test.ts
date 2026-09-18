// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { Settings, SessionLog, SpotStats } from '../../src/contracts';
import type { Core } from '../../src/ui/core';
import { mountSettings } from '../../src/ui/settings';
import { mountStats } from '../../src/ui/stats';

function fakeCore(stats: SpotStats[] = []): { core: Core; settings: Settings; log: SessionLog } {
  let settings: Settings = { controlScheme: 'swipe', altitude: 'nairobi', sound: true, footed: 'right' };
  let data = [...stats];
  const log: SessionLog = {
    record: vi.fn(),
    get: () => null,
    all: () => data,
    reset: vi.fn(() => {
      data = [];
    }),
  };
  const core = {
    log,
    settings: () => settings,
    updateSettings: vi.fn((p: Partial<Settings>) => {
      settings = { ...settings, ...p };
    }),
    go: vi.fn(),
    previous: () => 'title',
    refreshTrail: vi.fn(),
  } as unknown as Core;
  return {
    core,
    get settings() {
      return settings;
    },
    log,
  };
}

const q = <T extends Element>(root: Element, id: string): T => {
  const n = root.querySelector<T>(`[data-testid="${id}"]`);
  if (!n) throw new Error(`missing ${id}`);
  return n;
};

describe('settings screen', () => {
  it('applies every setting through updateSettings', () => {
    const f = fakeCore();
    const { el } = mountSettings(f.core);
    const scheme = q<HTMLSelectElement>(el, 'setting-scheme');
    expect(scheme.value).toBe('swipe');
    scheme.value = 'dial';
    scheme.dispatchEvent(new Event('change'));
    const alt = q<HTMLSelectElement>(el, 'setting-altitude');
    alt.value = 'sea';
    alt.dispatchEvent(new Event('change'));
    const foot = q<HTMLSelectElement>(el, 'setting-footed');
    foot.value = 'left';
    foot.dispatchEvent(new Event('change'));
    const sound = q<HTMLInputElement>(el, 'setting-sound');
    expect(sound.checked).toBe(true);
    sound.checked = false;
    sound.dispatchEvent(new Event('change'));
    expect(f.settings).toEqual({ controlScheme: 'dial', altitude: 'sea', sound: false, footed: 'left' });
  });

  it('reset data asks for an inline confirmation (no window.confirm)', () => {
    const f = fakeCore();
    const confirmSpy = vi.fn();
    window.confirm = confirmSpy;
    const { el } = mountSettings(f.core);
    q<HTMLButtonElement>(el, 'btn-reset-data').click();
    expect(f.log.reset).not.toHaveBeenCalled();
    q<HTMLButtonElement>(el, 'btn-reset-cancel').click();
    expect(f.log.reset).not.toHaveBeenCalled();
    q<HTMLButtonElement>(el, 'btn-reset-data').click();
    q<HTMLButtonElement>(el, 'btn-reset-confirm').click();
    expect(f.log.reset).toHaveBeenCalledTimes(1);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(q(el, 'reset-status').textContent).toMatch(/deleted/);
  });
});

describe('stats screen', () => {
  it('renders one row per spot with attempts, goals, % and average miss', () => {
    const f = fakeCore([
      { spotKey: 'fk-centre', mode: 'freeKick', attempts: 4, goals: 1, avgMissM: 0.75, best: null },
      { spotKey: 'pk-spot', mode: 'penalty', attempts: 3, goals: 3, avgMissM: 0, best: null },
    ]);
    const { el } = mountStats(f.core);
    const rows = [...q(el, 'stats-table').querySelectorAll('tbody tr')].map((r) =>
      [...r.children].map((c) => c.textContent),
    );
    expect(rows).toEqual([
      ['Centre of the D', 'Free kick', '4', '1', '25 %', '0.75 m'],
      ['Penalty spot', 'Penalty', '3', '3', '100 %', '–'],
    ]);
  });
  it('shows an empty state', () => {
    const { el } = mountStats(fakeCore().core);
    expect(q(el, 'stats-table').textContent).toMatch(/No kicks yet/);
  });
});
