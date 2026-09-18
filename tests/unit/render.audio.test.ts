import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAudio, type SoundName } from '../../src/audio';

const SOUNDS: SoundName[] = ['kick', 'post', 'net', 'crowd', 'whistle', 'save'];

/** Minimal WebAudio stand-in that records node creation and source starts. */
class FakeParam {
  value = 0;
  setValueAtTime() {
    return this;
  }
  exponentialRampToValueAtTime(v: number) {
    if (!(v > 0)) throw new RangeError('exponential ramp target must be > 0');
    return this;
  }
  setTargetAtTime() {
    return this;
  }
  cancelScheduledValues() {
    return this;
  }
}
class FakeNode {
  gain = new FakeParam();
  frequency = new FakeParam();
  Q = new FakeParam();
  type = '';
  buffer: unknown = null;
  loop = false;
  connect(n: unknown) {
    return n;
  }
  start() {
    FakeContext.starts++;
  }
  stop() {}
}
class FakeContext {
  static starts = 0;
  static instances = 0;
  static resumes = 0;
  state: 'suspended' | 'running' | 'interrupted' = 'suspended';
  sampleRate = 8000;
  currentTime = 0;
  destination = new FakeNode();
  constructor() {
    FakeContext.instances++;
  }
  resume() {
    FakeContext.resumes++;
    this.state = 'running';
    return Promise.resolve();
  }
  createGain() {
    return new FakeNode();
  }
  createOscillator() {
    return new FakeNode();
  }
  createBiquadFilter() {
    return new FakeNode();
  }
  createBufferSource() {
    return new FakeNode();
  }
  createBuffer(_c: number, len: number) {
    const data = new Float32Array(len);
    return { getChannelData: () => data };
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('audio', () => {
  it('is a silent no-op without WebAudio (never throws)', () => {
    vi.stubGlobal('window', {});
    const a = createAudio();
    expect(() => {
      a.unlock();
      for (const s of SOUNDS) a.play(s, 1);
      a.setEnabled(false);
      a.setEnabled(true);
    }).not.toThrow();
  });

  it('creates the context lazily on unlock and synthesises every sound', async () => {
    FakeContext.starts = 0;
    FakeContext.instances = 0;
    vi.stubGlobal('window', { AudioContext: FakeContext });
    const a = createAudio();
    a.play('kick');
    expect(FakeContext.instances).toBe(0);
    a.unlock();
    expect(FakeContext.instances).toBe(1);
    await Promise.resolve();
    await Promise.resolve();
    const before = FakeContext.starts;
    for (const s of SOUNDS) {
      a.play(s, 0);
      a.play(s, 0.5);
      a.play(s, 1);
      a.play(s);
    }
    expect(FakeContext.starts).toBeGreaterThan(before + SOUNDS.length);
    a.setEnabled(false);
    const muted = FakeContext.starts;
    a.play('kick', 1);
    expect(FakeContext.starts).toBe(muted);
  });

  it('starts a murmur requested before unlock once the context runs', async () => {
    FakeContext.starts = 0;
    vi.stubGlobal('window', { AudioContext: FakeContext });
    const a = createAudio();
    a.play('crowd');
    a.unlock();
    await Promise.resolve();
    await Promise.resolve();
    expect(FakeContext.starts).toBeGreaterThan(0);
  });

  it('swallows errors thrown by a broken AudioContext', () => {
    vi.stubGlobal('window', {
      AudioContext: class {
        constructor() {
          throw new Error('no audio device');
        }
      },
    });
    const a = createAudio();
    expect(() => {
      a.unlock();
      a.play('whistle');
    }).not.toThrow();
  });

  it('unlock is idempotent and resumes a suspended context every time', async () => {
    FakeContext.instances = 0;
    FakeContext.resumes = 0;
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    vi.stubGlobal('document', doc);
    vi.stubGlobal('window', { AudioContext: FakeContext });
    const a = createAudio();
    a.unlock();
    a.unlock();
    await Promise.resolve();
    await Promise.resolve();
    expect(FakeContext.instances).toBe(1);
    expect(FakeContext.resumes).toBe(1);
    a.unlock(); // already running: nothing to do
    expect(FakeContext.resumes).toBe(1);
    const started = FakeContext.starts;
    a.play('kick');
    expect(FakeContext.starts).toBeGreaterThan(started);
  });

  it('resumes after an interruption on unlock and on visibilitychange → visible', async () => {
    FakeContext.resumes = 0;
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    vi.stubGlobal('document', doc);
    const created: FakeContext[] = [];
    vi.stubGlobal('window', {
      AudioContext: class extends FakeContext {
        constructor() {
          super();
          created.push(this);
        }
      },
    });
    const a = createAudio();
    a.unlock();
    await Promise.resolve();
    expect(FakeContext.resumes).toBe(1);
    expect(created).toHaveLength(1);
    const c = created[0];
    c.state = 'interrupted';
    a.unlock();
    await Promise.resolve();
    expect(FakeContext.resumes).toBe(2);
    expect(c.state).toBe('running');
    c.state = 'suspended';
    doc.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    expect(FakeContext.resumes).toBe(3);
    expect(c.state).toBe('running');
  });
});
