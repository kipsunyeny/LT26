// WebAudio-synthesised sounds (no audio files): kick, post, net, crowd (murmur loop + cheer), whistle, save.
// The AudioContext is created lazily by unlock() (a user gesture). Every public call is exception-safe:
// without WebAudio the API is a silent no-op.
export type SoundName = 'kick' | 'post' | 'net' | 'crowd' | 'whistle' | 'save';
export interface AudioApi {
  play(name: SoundName, intensity?: number): void;
  setEnabled(on: boolean): void;
  /** Must be called from a user gesture before sounds can play (autoplay policy). */
  unlock(): void;
}

type Ctor = new () => AudioContext;

function audioContextCtor(): Ctor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

const MASTER_GAIN = 0.8;
const MURMUR_GAIN = 0.05;

function clamp01(x: number | undefined, fallback: number): number {
  if (x === undefined || !Number.isFinite(x)) return fallback;
  return Math.min(1, Math.max(0, x));
}

/** Deterministic white or brown noise. */
function noiseBuffer(ctx: AudioContext, seconds: number, brown: boolean): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let s = 0x2601;
  let last = 0;
  for (let i = 0; i < len; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const white = (s / 4294967296) * 2 - 1;
    if (brown) {
      last = (last + 0.02 * white) / 1.02;
      d[i] = last * 3.5;
    } else d[i] = white;
  }
  return buf;
}

class Synth {
  private readonly master: GainNode;
  private readonly white: AudioBuffer;
  private readonly brown: AudioBuffer;
  private murmurOn = false;

  constructor(readonly ctx: AudioContext) {
    this.master = ctx.createGain();
    this.master.gain.value = MASTER_GAIN;
    this.master.connect(ctx.destination);
    this.white = noiseBuffer(ctx, 1, false);
    this.brown = noiseBuffer(ctx, 4, true);
  }

  setEnabled(on: boolean): void {
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(on ? MASTER_GAIN : 0, t, 0.05);
  }

  /** Exponential attack/decay envelope feeding the master bus. */
  private env(peak: number, attack: number, decay: number, at: number): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
    g.connect(this.master);
    return g;
  }

  private noise(buf: AudioBuffer, at: number, dur: number, out: AudioNode, loop = false): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = loop;
    src.connect(out);
    src.start(at);
    if (!loop) src.stop(at + dur);
    return src;
  }

  private filter(type: BiquadFilterType, freq: number, q: number, out: AudioNode): BiquadFilterNode {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    f.connect(out);
    return f;
  }

  private tone(type: OscillatorType, f0: number, f1: number, at: number, dur: number, out: AudioNode): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, at);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, at + dur);
    o.connect(out);
    o.start(at);
    o.stop(at + dur + 0.02);
    return o;
  }

  kick(i: number): void {
    const t = this.ctx.currentTime;
    this.tone('sine', 150, 48, t, 0.14, this.env(0.9 * (0.4 + 0.6 * i), 0.004, 0.14, t));
    const click = this.env(0.35 * (0.3 + 0.7 * i), 0.002, 0.035, t);
    this.noise(this.white, t, 0.04, this.filter('highpass', 1800, 0.7, click));
  }

  post(i: number): void {
    const t = this.ctx.currentTime;
    const a = 0.25 * (0.4 + 0.6 * i);
    // Inharmonic partials of a struck metal tube: [frequency Hz, relative amplitude, decay s].
    const partials: [number, number, number][] = [
      [523, 1, 1.1],
      [1371, 0.6, 0.8],
      [2213, 0.35, 0.55],
      [3302, 0.2, 0.35],
    ];
    for (const [f, amp, decay] of partials) this.tone('sine', f, f, t, decay, this.env(a * amp, 0.002, decay, t));
    this.tone('sine', 110, 60, t, 0.1, this.env(0.2 + 0.5 * i, 0.003, 0.1, t));
  }

  net(i: number): void {
    const t = this.ctx.currentTime;
    const bp = this.filter('bandpass', 1100, 0.8, this.env(0.45 * (0.3 + 0.7 * i), 0.02, 0.45, t));
    bp.frequency.setValueAtTime(1100, t);
    bp.frequency.exponentialRampToValueAtTime(300, t + 0.45);
    this.noise(this.white, t, 0.5, bp);
  }

  save(i: number): void {
    const t = this.ctx.currentTime;
    const slap = this.env(0.6 * (0.3 + 0.7 * i), 0.003, 0.08, t);
    this.noise(this.white, t, 0.09, this.filter('bandpass', 1300, 1.2, slap));
    this.tone('sine', 95, 55, t, 0.12, this.env(0.5 * (0.3 + 0.7 * i), 0.004, 0.12, t));
  }

  whistle(i: number): void {
    const t = this.ctx.currentTime;
    const dur = 0.45;
    const level = 0.22 * (0.5 + 0.5 * i);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.02);
    g.gain.setValueAtTime(level, t + dur - 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(this.master);
    const o = this.tone('sine', 2850, 2850, t, dur, g);
    // Pea trill: fast frequency wobble.
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 32;
    const depth = this.ctx.createGain();
    depth.gain.value = 120;
    lfo.connect(depth);
    depth.connect(o.frequency);
    lfo.start(t);
    lfo.stop(t + dur + 0.02);
  }

  /** Starts the murmur loop once; intensity ≥ 0.5 adds a cheer swell on top. */
  crowd(i: number): void {
    const t = this.ctx.currentTime;
    if (!this.murmurOn) {
      this.murmurOn = true;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(MURMUR_GAIN, t + 1.5);
      gain.connect(this.master);
      this.noise(this.brown, t, 0, this.filter('lowpass', 520, 0.5, gain), true);
    }
    if (i >= 0.5) {
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.35 * i, t + 0.35);
      g.gain.setTargetAtTime(0.0001, t + 1.2, 0.6);
      g.connect(this.master);
      this.noise(this.white, t, 3.5, this.filter('bandpass', 1400, 0.6, g));
      this.noise(this.brown, t, 3.5, this.filter('lowpass', 700, 0.7, g));
    }
  }
}

export function createAudio(): AudioApi {
  let synth: Synth | null = null;
  let enabled = true;
  let failed = false;
  /** A murmur requested before the context was running starts as soon as it resumes. */
  let murmurWanted = false;

  const startPendingMurmur = () => {
    try {
      if (murmurWanted && enabled && synth && synth.ctx.state === 'running') {
        murmurWanted = false;
        synth.crowd(0);
      }
    } catch {
      // See play().
    }
  };

  const ensure = (): Synth | null => {
    if (synth || failed) return synth;
    const C = audioContextCtor();
    if (!C) {
      failed = true;
      return null;
    }
    try {
      synth = new Synth(new C());
      synth.setEnabled(enabled);
    } catch {
      failed = true;
      synth = null;
    }
    return synth;
  };

  return {
    play(name: SoundName, intensity?: number): void {
      try {
        const i = clamp01(intensity, name === 'crowd' ? 0.3 : 0.8);
        if (!enabled || !synth || synth.ctx.state !== 'running') {
          if (name === 'crowd') murmurWanted = true;
          return;
        }
        switch (name) {
          case 'kick':
            synth.kick(i);
            break;
          case 'post':
            synth.post(i);
            break;
          case 'net':
            synth.net(i);
            break;
          case 'crowd':
            synth.crowd(i);
            break;
          case 'whistle':
            synth.whistle(i);
            break;
          case 'save':
            synth.save(i);
            break;
        }
      } catch {
        // Audio is decoration: it must never break the game.
      }
    },

    setEnabled(on: boolean): void {
      enabled = on;
      try {
        synth?.setEnabled(on);
        if (on) startPendingMurmur();
      } catch {
        // See play().
      }
    },

    unlock(): void {
      try {
        const s = ensure();
        if (!s) return;
        if (s.ctx.state === 'running') startPendingMurmur();
        else s.ctx.resume().then(startPendingMurmur, () => undefined);
      } catch {
        // See play().
      }
    },
  };
}
