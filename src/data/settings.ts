// Settings persistence. Owned by the orchestrator (shared by sim and UI).
import type { Settings } from '../contracts';

export const SETTINGS_KEY = 'lt26.settings.v1';

export function defaultSettings(): Settings {
  const touch = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);
  return { controlScheme: touch ? 'swipe' : 'dial', altitude: 'nairobi', sound: true, footed: 'right' };
}

export function loadSettings(storage: Storage | null): Settings {
  const d = defaultSettings();
  if (!storage) return d;
  try {
    const raw = storage.getItem(SETTINGS_KEY);
    if (!raw) return d;
    const s = JSON.parse(raw) as Partial<Settings>;
    return {
      controlScheme: s.controlScheme === 'dial' || s.controlScheme === 'swipe' ? s.controlScheme : d.controlScheme,
      altitude: s.altitude === 'sea' || s.altitude === 'nairobi' ? s.altitude : d.altitude,
      sound: typeof s.sound === 'boolean' ? s.sound : d.sound,
      footed: s.footed === 'left' || s.footed === 'right' ? s.footed : d.footed,
    };
  } catch {
    return d;
  }
}

export function saveSettings(storage: Storage | null, s: Settings): void {
  if (!storage) return;
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* storage full or blocked: settings stay in memory */
  }
}
