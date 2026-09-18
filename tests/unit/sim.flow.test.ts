// Recording, long shot flow, determinism, spots, taker placement and settings.
import { describe, expect, it } from 'vitest';
import type { WorldSnapshot } from '../../src/contracts';
import { launchState, mulberry32, simulate } from '../../src/physics';
import { rhoFor } from '../../src/sim';
import { newSim, penalty, runToResult, strike } from './sim.helpers';

describe('recording', () => {
  it('60 Hz frames from the strike to the result + 0.5 s, identical to the live world', () => {
    const { sim, events } = newSim(4);
    sim.setMode('freeKick');
    sim.setSpot('fk-left-d');
    const live: WorldSnapshot[] = [];
    sim.applyIntent(strike({ kind: 'target', x: 2.8, y: 1.2 }, 0.75, 4, 1));
    live.push(sim.state.world);
    for (let i = 0; i < 600; i++) {
      sim.update(1 / 240);
      live.push(sim.state.world);
      if (sim.state.phase === 'result' && sim.state.time > (sim.state.lastRecording?.frames.at(-1)?.t ?? 0) + 0.6)
        break;
    }
    const rec = sim.state.lastRecording;
    expect(rec).not.toBeNull();
    if (!rec) return;
    const f = rec.frames;
    for (let i = 1; i < f.length; i++) expect(f[i].t - f[i - 1].t).toBeCloseTo(1 / 60, 9);
    const kick = events.find((e) => e.type === 'kick');
    const result = events.find((e) => e.type === 'result');
    if (kick?.type !== 'kick' || result?.type !== 'result') throw new Error('missing events');
    expect(f[0].t).toBeCloseTo(kick.t, 9);
    expect(f.at(-1)?.t).toBeGreaterThanOrEqual(result.t + 0.5 - 1 / 60);
    expect(f.at(-1)?.t).toBeLessThan(result.t + 0.5 + 1 / 60);
    // Every recorded frame equals the live world at that time (no re-simulation).
    for (const fr of f) {
      const w = live.find((l) => Math.abs(l.t - fr.t) < 1e-9);
      expect(w).toBeDefined();
      expect(fr).toEqual(w);
    }
    expect(rec.summary).toBe(sim.state.lastShot);
    expect(rec.events.some((e) => e.type === 'kick')).toBe(true);
    expect(rec.events.some((e) => e.type === 'result')).toBe(true);
    // Summary path is ≈60 Hz.
    const path = rec.summary.path;
    expect(path.length).toBeGreaterThan(rec.summary.timeToGoalS * 50);
    expect(launchState(kick.launch).p).toEqual(path[0]);
  });

  it("replay integrity: recorded ball frames equal physics simulate() of the launch with the shot's own seed", () => {
    // A spinless 100 km/h kick knuckles, so the noise seed matters. The sim draws its first shot's noise seed as
    // the first value of mulberry32(simSeed).
    const simSeed = 21;
    const { sim, events } = newSim(simSeed);
    sim.setMode('freeKick');
    sim.setSpot('fk-wide-right');
    sim.applyIntent(strike({ kind: 'angles', azimuth: -0.33, elevation: 0.2 }, 0.8, 0, 0));
    runToResult(sim);
    const kick = events.find((e) => e.type === 'kick');
    const rec = sim.state.lastRecording;
    if (kick?.type !== 'kick' || !rec) throw new Error('no kick');
    const firstContact = events.find((e) => e.type === 'contact')?.t ?? Infinity;
    const noiseSeed = Math.floor(mulberry32(simSeed)() * 0x7fffffff);
    const env = { rho: rhoFor(sim.state.settings), seed: noiseSeed };
    const tr = simulate(kick.launch, env, { maxTime: 3, stopAtRest: false });
    const wrongSeed = simulate(kick.launch, { ...env, seed: noiseSeed + 1 }, { maxTime: 3, stopAtRest: false });
    let compared = 0;
    let seedMatters = false;
    rec.frames.forEach((fr, i) => {
      if (fr.t >= firstContact - 1e-9 || i * 4 >= tr.samples.length) return;
      const s = tr.samples[i * 4];
      expect(fr.ball.p.x).toBeCloseTo(s.p.x, 9);
      expect(fr.ball.p.y).toBeCloseTo(s.p.y, 9);
      expect(fr.ball.p.z).toBeCloseTo(s.p.z, 9);
      if (Math.abs(wrongSeed.samples[i * 4].p.x - s.p.x) > 1e-6) seedMatters = true;
      compared++;
    });
    expect(compared).toBeGreaterThan(20);
    expect(seedMatters).toBe(true);
  });
});

describe('long shot', () => {
  it('push → rolling ball, taker runs onto it, strike timed against the moment he reaches it', () => {
    const { sim, events } = newSim(2);
    sim.setMode('longShot');
    expect(sim.state.spotKey).toBe('ls-centre');
    const d0 = sim.state.world.defender?.p;
    expect(d0 && d0.z).toBeCloseTo(26 - 10, 0);
    sim.applyIntent({
      kind: 'push',
      scheme: 'swipe',
      aim: { kind: 'angles', azimuth: 0, elevation: 0 },
      power: 0.5,
      sideSpin: 0,
      topSpin: 0,
      atMs: 0,
    });
    expect(sim.state.phase).toBe('pushed');
    const rs = events.find((e) => e.type === 'runUpStart');
    if (rs?.type !== 'runUpStart') throw new Error('no runUpStart');
    expect(sim.startRunUp()).toBeCloseTo(rs.contactAt, 12);
    expect(rs.contactAt).toBeGreaterThan(0.5);
    expect(rs.contactAt).toBeLessThan(2.5);
    const z0 = sim.state.ball.p.z;
    while (sim.state.time < rs.contactAt - 1e-9) sim.update(1 / 240);
    const ball = sim.state.ball;
    expect(ball.p.z).toBeLessThan(z0 - 2); // it rolled towards goal
    expect(ball.p.y).toBeCloseTo(0.11, 3);
    expect(ball.v.z).toBeLessThan(-1);
    const taker = sim.state.world.taker;
    expect(taker.stride).toBeCloseTo(1, 6);
    expect(Math.hypot(taker.p.x - ball.p.x, taker.p.z - ball.p.z)).toBeLessThan(1);
    const def = sim.state.world.defender;
    expect(def).not.toBeNull();
    if (def) expect(Math.hypot(def.p.x - ball.p.x, def.p.z - ball.p.z)).toBeGreaterThanOrEqual(2.2);
    sim.applyIntent(strike({ kind: 'angles', azimuth: -0.12, elevation: 0.12 }, 0.8, -3, 0, sim.state.time * 1000));
    const k = events.find((e) => e.type === 'kick');
    if (k?.type !== 'kick') throw new Error('no kick');
    expect(Math.abs(k.timingErrorMs)).toBeLessThan(5);
    expect(k.launch.speed * 3.6).toBeGreaterThan(100 + 3); // rolling ball adds to the 100 km/h kick
    runToResult(sim);
    expect(sim.state.lastShot?.mode).toBe('longShot');
  });

  it('a late strike costs power and adds scatter', () => {
    const { sim, events } = newSim(2);
    sim.setMode('longShot');
    sim.applyIntent({
      kind: 'push',
      scheme: 'swipe',
      aim: { kind: 'angles', azimuth: 0, elevation: 0 },
      power: 0.5,
      sideSpin: 0,
      topSpin: 0,
      atMs: 0,
    });
    const contactAt = sim.startRunUp();
    while (sim.state.time < contactAt + 0.3) sim.update(1 / 240);
    sim.applyIntent(strike({ kind: 'angles', azimuth: 0, elevation: 0.12 }, 0.8, 0, 0, sim.state.time * 1000));
    const k = events.find((e) => e.type === 'kick');
    if (k?.type !== 'kick') throw new Error('no kick');
    expect(k.timingErrorMs).toBeGreaterThan(290);
    expect(k.scatterDeg).toBeGreaterThan(2);
  });
});

describe('determinism and set-up', () => {
  it('same seed and intents ⇒ same summary and recording', () => {
    const a = penalty(9, { x: -2.2, y: 0.8 }, 0.95);
    const b = penalty(9, { x: -2.2, y: 0.8 }, 0.95);
    runToResult(a.sim);
    runToResult(b.sim);
    expect(a.sim.state.lastShot).toEqual(b.sim.state.lastShot);
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    const c = penalty(10, { x: -2.2, y: 0.8 }, 0.95);
    runToResult(c.sim);
    expect(c.sim.state.lastShot).not.toEqual(a.sim.state.lastShot);
  });

  it('free placement is clamped to 16–35 m, outside the box, keyed fk-x{X}-z{Z}', () => {
    const { sim } = newSim(1);
    sim.setMode('freeKick');
    sim.setSpot({ x: 3.4, z: 25.2 });
    expect(sim.state.spotKey).toBe('fk-x3-z25');
    expect(sim.state.ballStart).toEqual({ x: 3, y: 0.11, z: 25 });
    sim.setSpot({ x: 0, z: 60 });
    expect(Math.hypot(sim.state.ballStart.x, sim.state.ballStart.z)).toBeLessThanOrEqual(35);
    sim.setSpot({ x: 2, z: 10 });
    const b = sim.state.ballStart;
    expect(Math.hypot(b.x, b.z)).toBeGreaterThanOrEqual(16);
    expect(b.z > 16.5 || Math.abs(b.x) > 20.16).toBe(true);
    sim.setSpot('fk-x3-z25');
    expect(sim.state.ballStart.x).toBe(3);
    sim.setSpot('fk-wide-left');
    expect(sim.state.spotKey).toBe('fk-wide-left');
    sim.setMode('penalty');
    sim.setSpot({ x: 5, z: 20 });
    expect(sim.state.spotKey).toBe('pk-spot');
  });

  it('taker stands beside the ball, left for a right-footer, mirrored for a left-footer, off the ball→goal line', () => {
    const { sim } = newSim(1);
    sim.setMode('penalty');
    const t = sim.state.world.taker.p;
    expect(t.x).toBeCloseTo(-0.6, 9);
    expect(t.z).toBeCloseTo(11.5, 9);
    sim.setSettings({ footed: 'left' });
    expect(sim.state.world.taker.p.x).toBeCloseTo(0.6, 9);
    const contactAt = sim.startRunUp();
    expect(contactAt).toBeCloseTo(0.9, 9);
    const start = sim.state.world.taker;
    expect(start.stride).toBe(0);
    expect(Math.hypot(start.p.x, start.p.z - 11)).toBeGreaterThan(2.3);
    for (let i = 0; i < 27; i++) sim.update(1 / 60);
    expect(sim.state.world.taker.stride).toBeGreaterThan(0.4);
    expect(sim.state.world.taker.stride).toBeLessThan(0.6);
  });

  it('altitude setting changes air density and the curve', () => {
    const curve = (alt: 'sea' | 'nairobi'): number => {
      const { sim } = newSim(1, { altitude: alt });
      sim.setMode('freeKick');
      sim.setSpot('fk-centre');
      const p = sim.previewPath(strike({ kind: 'angles', azimuth: -0.1, elevation: 0.12 }, 0.8, 8, 0));
      return p.at(-1)?.x ?? 0;
    };
    expect(curve('sea')).toBeGreaterThan(curve('nairobi') + 0.2);
  });

  it('phases: aiming → flight → result, resetShot back to aiming; ignored intents', () => {
    const { sim, events } = newSim(1);
    sim.setMode('freeKick');
    sim.applyIntent({ ...strike({ kind: 'angles', azimuth: 0, elevation: 0.2 }, 0.5), kind: 'push' });
    expect(sim.state.phase).toBe('aiming');
    sim.applyIntent(strike({ kind: 'angles', azimuth: 0.2, elevation: 0.25 }, 0.6, 5, 1));
    expect(sim.state.phase).toBe('flight');
    sim.applyIntent(strike({ kind: 'angles', azimuth: 0, elevation: 0.2 }, 0.5));
    expect(events.filter((e) => e.type === 'kick').length).toBe(1);
    runToResult(sim);
    expect(sim.state.phase).toBe('result');
    sim.resetShot();
    expect(sim.state.phase).toBe('aiming');
    expect(sim.state.ball.p).toEqual(sim.state.ballStart);
    expect(sim.state.lastShot).not.toBeNull();
    const phases = events.filter((e) => e.type === 'phase').map((e) => (e.type === 'phase' ? e.phase : ''));
    expect(phases).toEqual(['flight', 'result', 'aiming']);
  });

  it('solveAim and previewPath use the same physics and reach the target', () => {
    const { sim } = newSim(1);
    sim.setMode('freeKick');
    const l = sim.solveAim({ x: -2.5, y: 1.8 }, 95, -6, 2);
    expect(l).not.toBeNull();
    const path = sim.previewPath(strike({ kind: 'target', x: -2.5, y: 1.8 }, (95 - 40) / 75, -6, 2));
    const i = path.findIndex((p) => p.z < 0);
    const a = path[i - 1];
    const b = path[i];
    const u = a.z / (a.z - b.z);
    expect(a.x + (b.x - a.x) * u).toBeCloseTo(-2.5, 1);
    expect(a.y + (b.y - a.y) * u).toBeCloseTo(1.8, 1);
  });
});

describe('run-up control', () => {
  it('cancelRunUp: back to aiming, taker beside the ball, no penalty; a new run-up works', () => {
    const { sim, events } = newSim(1);
    sim.setMode('penalty');
    const stand = { ...sim.state.world.taker.p };
    sim.startRunUp();
    for (let i = 0; i < 18; i++) sim.update(1 / 60);
    expect(sim.state.phase).toBe('runUp');
    sim.cancelRunUp();
    expect(sim.state.phase).toBe('aiming');
    expect(sim.state.world.taker.p).toEqual(stand);
    expect(sim.state.world.taker.stride).toBe(0);
    expect(events.some((e) => e.type === 'kick')).toBe(false);
    sim.cancelRunUp(); // no-op outside a run-up
    expect(sim.state.phase).toBe('aiming');
    const c = sim.startRunUp();
    expect(c).toBeCloseTo(sim.state.time + 0.9, 9);
    expect(sim.state.phase).toBe('runUp');
  });

  it('a run-up still pending 1.0 s after the ideal contact is aborted', () => {
    const { sim } = newSim(1);
    sim.setMode('penalty');
    const c = sim.startRunUp();
    while (sim.state.time < c + 0.99) sim.update(1 / 240);
    expect(sim.state.phase).toBe('runUp');
    while (sim.state.time < c + 1.02) sim.update(1 / 240);
    expect(sim.state.phase).toBe('aiming');
  });

  it('a strike while aiming is ignored in penalty (needs a run-up) and long shot (needs a push)', () => {
    for (const mode of ['penalty', 'longShot'] as const) {
      const { sim, events } = newSim(1);
      sim.setMode(mode);
      sim.applyIntent(strike({ kind: 'target', x: 2, y: 1 }, 0.7));
      expect(sim.state.phase).toBe('aiming');
      expect(events.some((e) => e.type === 'kick')).toBe(false);
    }
  });
});

describe('long-shot push distances and the automatic scuff', () => {
  const push = (sim: ReturnType<typeof newSim>['sim'], power: number): void => {
    const b = sim.state.ball.p;
    sim.applyIntent({
      kind: 'push',
      scheme: 'dial',
      aim: { kind: 'angles', azimuth: Math.atan2(-b.x, b.z), elevation: 0 },
      power,
      sideSpin: 0,
      topSpin: 0,
      atMs: sim.state.time * 1000,
    });
  };

  it('the push is a short touch: the ball rolls ≈2–5 m before the taker reaches it', () => {
    const rows: string[] = [];
    for (const key of ['ls-centre', 'ls-left', 'ls-right'])
      for (const power of [0, 0.5, 1]) {
        const { sim } = newSim(1);
        sim.setMode('longShot');
        sim.setSpot(key);
        const b0 = { ...sim.state.ball.p };
        push(sim, power);
        const c = sim.startRunUp();
        while (sim.state.time < c - 1e-9) sim.update(1 / 240);
        const p = sim.state.ball.p;
        const rolled = Math.hypot(p.x - b0.x, p.z - b0.z);
        rows.push(`${key} p${power}: ${rolled.toFixed(2)} m at ${(c * 1000).toFixed(0)} ms`);
        expect(rolled).toBeGreaterThanOrEqual(1.8);
        expect(rolled).toBeLessThanOrEqual(5);
        expect(Math.hypot(p.x, p.z)).toBeGreaterThanOrEqual(18);
      }
    console.log(`[longshot] roll at ideal contact: ${rows.join('; ')}`);
  });

  it('no strike by ideal contact + 0.6 s: the taker scuffs it low towards the goal centre, still ≥ 18 m out', () => {
    for (const key of ['ls-centre', 'ls-left', 'ls-right']) {
      const { sim, events } = newSim(3);
      sim.setMode('longShot');
      sim.setSpot(key);
      push(sim, 1);
      const c = sim.startRunUp();
      while (sim.state.phase === 'pushed') sim.update(1 / 240);
      const k = events.find((e) => e.type === 'kick');
      if (k?.type !== 'kick') throw new Error('no scuff');
      expect(k.t).toBeCloseTo(c + 0.6, 2);
      expect(k.timingErrorMs).toBeGreaterThanOrEqual(595);
      expect(k.scatterDeg).toBeCloseTo(3, 9);
      expect(Math.hypot(k.launch.origin.x, k.launch.origin.z)).toBeGreaterThanOrEqual(18);
      expect(k.launch.speed * 3.6).toBeLessThan(55 * 0.75 + 12);
      const toGoal = Math.atan2(-k.launch.origin.x, k.launch.origin.z);
      expect(Math.abs(k.launch.azimuth - toGoal)).toBeLessThan(0.2);
    }
  });

  it('a shot into the closing defender is a block reported as "wall", timed at the defender contact', () => {
    const { sim, events } = newSim(5);
    sim.setMode('longShot');
    push(sim, 0.5);
    const c = sim.startRunUp();
    while (sim.state.time < c - 1e-9) sim.update(1 / 240);
    const d = sim.state.world.defender?.p;
    const b = sim.state.ball.p;
    if (!d) throw new Error('no defender');
    sim.applyIntent(
      strike({ kind: 'angles', azimuth: Math.atan2(d.x - b.x, b.z - d.z), elevation: 0.12 }, 0.7, 0, 0, c * 1000),
    );
    runToResult(sim);
    const kick = events.find((e) => e.type === 'kick');
    const hit = events.find((e) => e.type === 'contact' && e.contact.tag === 'defender');
    expect(hit).toBeDefined();
    const s = sim.state.lastShot;
    expect(s?.result).toBe('wall');
    if (hit && kick && s) expect(s.timeToGoalS).toBeCloseTo(hit.t - kick.t, 6);
    expect(s?.missDistanceM).toBeGreaterThanOrEqual(0);
    expect(s?.missDistanceM).toBeLessThan(3);
  });
});

describe('miss distance and time for saved shots', () => {
  it('a saved on-target penalty has missDistanceM 0 and timeToGoalS at the keeper contact', () => {
    let checked = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const { sim, events } = penalty(seed, { x: 0.2, y: 1.2 }, 0.85);
      runToResult(sim);
      const s = sim.state.lastShot;
      if (s?.result !== 'saved' && s?.result !== 'caught') continue;
      const kick = events.find((e) => e.type === 'kick');
      const touch = events.find(
        (e) => e.type === 'contact' && (e.contact.tag === 'keeperHand' || e.contact.tag === 'keeperBody'),
      );
      if (!kick || !touch) throw new Error('missing events');
      expect(s.missDistanceM).toBe(0);
      expect(s.timeToGoalS).toBeCloseTo(touch.t - kick.t, 6);
      checked++;
    }
    expect(checked).toBeGreaterThan(5);
  });
});
