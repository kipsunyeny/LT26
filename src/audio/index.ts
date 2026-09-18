// STUB (Phase 0) — replaced by the rendering engineer (audio is presentation).
export type SoundName = 'kick' | 'post' | 'net' | 'crowd' | 'whistle' | 'save';
export interface AudioApi {
  play(name: SoundName, intensity?: number): void;
  setEnabled(on: boolean): void;
  /** Must be called from a user gesture before sounds can play (autoplay policy). */
  unlock(): void;
}
export function createAudio(): AudioApi {
  return { play() {}, setEnabled() {}, unlock() {} };
}
