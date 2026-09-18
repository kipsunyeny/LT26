// Spot keys and labels for the HUD and stats. Keys are fixed by docs/ARCHITECTURE.md §3; the
// sim owns the actual positions (data/presets.ts), the UI only needs keys and names.
import type { Mode } from '../contracts';

export interface UiSpot {
  key: string;
  label: string;
  short: string;
}

export const UI_SPOTS: Record<Mode, UiSpot[]> = {
  freeKick: [
    { key: 'fk-centre', label: 'Centre of the D', short: 'Centre' },
    { key: 'fk-left-d', label: 'Left edge of the D', short: 'Left D' },
    { key: 'fk-right-d', label: 'Right edge of the D', short: 'Right D' },
    { key: 'fk-wide-left', label: 'Wide left', short: 'Wide L' },
    { key: 'fk-wide-right', label: 'Wide right', short: 'Wide R' },
  ],
  penalty: [{ key: 'pk-spot', label: 'Penalty spot', short: 'Spot' }],
  longShot: [
    { key: 'ls-centre', label: 'Long shot, centre', short: 'Centre' },
    { key: 'ls-left', label: 'Long shot, left', short: 'Left' },
    { key: 'ls-right', label: 'Long shot, right', short: 'Right' },
  ],
};

export const MODE_LABEL: Record<Mode, string> = {
  freeKick: 'Free kick',
  penalty: 'Penalty',
  longShot: 'Long shot',
};

const FREE = /^fk-x(-?\d+)-z(\d+)$/;

export function spotLabel(key: string): string {
  for (const list of Object.values(UI_SPOTS)) {
    const s = list.find((x) => x.key === key);
    if (s) return s.label;
  }
  const m = FREE.exec(key);
  if (m) {
    const x = Number(m[1]);
    const side = x === 0 ? 'centre' : `${Math.abs(x)} m ${x < 0 ? 'left' : 'right'}`;
    return `Free kick ${m[2]} m out, ${side}`;
  }
  return key;
}
