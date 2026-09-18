// Recording, long shot flow, determinism, spots, taker placement and settings.
import { describe, expect, it } from 'vitest';
import type { WorldSnapshot } from '../../src/contracts';
import { launchState, simulate } from '../../src/physics';
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
    // Flight matches the physics simulate() of the same launch until the first contact.
    const tr = simulate(kick.launch, { rho: rhoFor(sim.state.settings), seed: 0 }, { maxTime: 0.3 });
    const s72 = tr.samples[72];
    const fr18 = f[18];
    expect(fr18.ball.p.x).toBeCloseTo(s72.p.x, 9);
    expect(fr18.ball.p.y).toBeCloseTo(s72.p.y, 9);
    // Summary path is ≈60 Hz.
    const path = rec.summary.path;
    expect(path.length).toBeGreaterThan(rec.summary.timeToGoalS * 50);
    expect(launchState(kick.launch).p).toEqual(path[0]);
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
