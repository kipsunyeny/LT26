import { describe, expect, it } from 'vitest';
import { loadSettings, saveSettings } from '../../src/data/settings';

class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

describe('settings', () => {
  it('defaults to Nairobi altitude and round-trips', () => {
    const st = new MemStorage() as unknown as Storage;
    const s = loadSettings(st);
    expect(s.altitude).toBe('nairobi');
    saveSettings(st, { ...s, altitude: 'sea', footed: 'left' });
    expect(loadSettings(st)).toMatchObject({ altitude: 'sea', footed: 'left' });
  });
  it('ignores corrupt data', () => {
    const st = new MemStorage() as unknown as Storage;
    st.setItem('lt26.settings.v1', '{nope');
    expect(loadSettings(st).sound).toBe(true);
  });
});
