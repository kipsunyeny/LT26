import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/physics';
import { applyScatter, powerScatterDeg, resolveLaunch, speedFromPower, timingPenalty } from '../../src/sim/kick';
import { newSim, penalty, strike } from './sim.helpers';

const DEG = Math.PI / 180;

describe('power, scatter and timing maths', () => {
  it('speed = 40 + 75·power km/h', () => {
    expect(speedFromPower(0) * 3.6).toBeCloseTo(40, 9);
    expect(speedFromPower(1) * 3.6).toBeCloseTo(115, 9);
    expect(speedFromPower(0.85) * 3.6).toBeCloseTo(103.75, 9);
  });
  it('scatter σ: 0 below 90 %, 1.5° at 90 %, 2.5° at 95 %, 3.5° at 100 %', () => {
    expect(powerScatterDeg(0.89)).toBe(0);
    expect(powerScatterDeg(0.9)).toBeCloseTo(1.5, 9);
    expect(powerScatterDeg(0.95)).toBeCloseTo(2.5, 9);
    expect(powerScatterDeg(1)).toBeCloseTo(3.5, 9);
  });
  it('penalty run-up timing: full speed within ±80 ms, then linear to ×0.75 and +3° at 400 ms', () => {
    expect(timingPenalty(0)).toEqual({ speedMult: 1, sigmaDeg: 0 });
    expect(timingPenalty(-80)).toEqual({ speedMult: 1, sigmaDeg: 0 });
    const mid = timingPenalty(240);
    expect(mid.speedMult).toBeCloseTo(0.875, 9);
    expect(mid.sigmaDeg).toBeCloseTo(1.5, 9);
    expect(timingPenalty(-400).speedMult).toBeCloseTo(0.75, 9);
    expect(timingPenalty(-400).sigmaDeg).toBeCloseTo(3, 9);
    expect(timingPenalty(900)).toEqual(timingPenalty(400));
  });
  it('long-shot timing: early/late costs 10 % just outside ±80 ms, rising to 25 % at 400 ms', () => {
    expect(timingPenalty(80, 'longShot')).toEqual({ speedMult: 1, sigmaDeg: 0 });
    expect(timingPenalty(81, 'longShot').speedMult).toBeCloseTo(0.9, 2);
    expect(timingPenalty(-240, 'longShot').speedMult).toBeCloseTo(0.825, 9);
    expect(timingPenalty(400, 'longShot').speedMult).toBeCloseTo(0.75, 9);
    expect(timingPenalty(400, 'longShot').sigmaDeg).toBeCloseTo(3, 9);
  });
  it('a target below the ball radius is clamped to y = 0.11 (continuous aim at the bottom of the goal)', () => {
    const o = { x: 0, y: 0.11, z: 11 };
    const env = { rho: 1.2, seed: 1 };
    const zero = { x: 0, y: 0, z: 0 };
    const low = resolveLaunch(strike({ kind: 'target', x: 2, y: 0 }, 0.6), o, zero, 1, env);
    const r = resolveLaunch(strike({ kind: 'target', x: 2, y: 0.11 }, 0.6), o, zero, 1, env);
    const r2 = resolveLaunch(strike({ kind: 'target', x: 2, y: 0.12 }, 0.6), o, zero, 1, env);
    expect(low).toEqual(r);
    expect(Math.abs(r2.elevation - r.elevation)).toBeLessThan(0.01);
  });
  it('target aim with a moving ball: kick + ball velocity reaches the target and the foot adds exactly the kick speed', () => {
    const o = { x: 0, y: 0.11, z: 24 };
    const env = { rho: 1.2, seed: 1 };
    const vb = { x: 1.2, y: 0, z: -2.4 };
    const l = resolveLaunch(strike({ kind: 'target', x: -2.5, y: 1.5 }, 0.8, -4, 0), o, vb, 1, env);
    const c = simulate(l, env, { stopAtGoalLine: true }).lineCrossing;
    expect(c?.p.x).toBeCloseTo(-2.5, 1);
    expect(c?.p.y).toBeCloseTo(1.5, 1);
    const ce = Math.cos(l.elevation);
    const k = Math.hypot(
      l.speed * ce * Math.sin(l.azimuth) - vb.x,
      l.speed * Math.sin(l.elevation) - vb.y,
      -l.speed * ce * Math.cos(l.azimuth) - vb.z,
    );
    expect(k).toBeCloseTo(speedFromPower(0.8), 1);
  });
  it('scatter is applied in degrees to azimuth and elevation', () => {
    const l = { origin: { x: 0, y: 0.11, z: 20 }, speed: 30, azimuth: 0.1, elevation: 0.2, sideSpin: 0, topSpin: 0 };
    const s = applyScatter(l, 2, 1, -0.5);
    expect(s.azimuth - l.azimuth).toBeCloseTo(2 * DEG, 12);
    expect(s.elevation - l.elevation).toBeCloseTo(-1 * DEG, 12);
    expect(applyScatter(l, 0, 1, 1)).toBe(l);
  });
  it('angles aim adds the moving ball velocity to the kick', () => {
    const intent = strike({ kind: 'angles', azimuth: 0, elevation: 0.1 }, 0.5);
    const o = { x: 0, y: 0.11, z: 20 };
    const still = resolveLaunch(intent, o, { x: 0, y: 0, z: 0 }, 1, { rho: 1.2, seed: 1 });
    const moving = resolveLaunch(intent, o, { x: 0, y: 0, z: -4 }, 1, { rho: 1.2, seed: 1 });
    expect(moving.speed).toBeGreaterThan(still.speed + 3.9);
  });
  it('an unreachable target still gives a launch towards it (mis-aim possible)', () => {
    const intent = strike({ kind: 'target', x: 2, y: 30 }, 0);
    const l = resolveLaunch(intent, { x: 0, y: 0.11, z: 30 }, { x: 0, y: 0, z: 0 }, 1, { rho: 1.2, seed: 1 });
    expect(l.azimuth).toBeCloseTo(Math.atan2(2, 30), 9);
    expect(l.elevation).toBeGreaterThan(0);
  });
});

describe('scatter and timing in play', () => {
  it('empirical azimuth σ at 90/95/100 % matches 1.5/2.5/3.5°', () => {
    for (const [power, sigma] of [
      [0.9, 1.5],
      [0.95, 2.5],
      [1, 3.5],
    ]) {
      const devs: number[] = [];
      for (let seed = 1; seed <= 300; seed++) {
        const { sim, events } = newSim(seed);
        sim.setMode('freeKick');
        sim.applyIntent(strike({ kind: 'angles', azimuth: 0.05, elevation: 0.2 }, power));
        const k = events.find((e) => e.type === 'kick');
        if (k?.type !== 'kick') throw new Error('no kick');
        expect(k.scatterDeg).toBeCloseTo(sigma, 9);
        devs.push((k.launch.azimuth - 0.05) / DEG);
      }
      const sd = Math.sqrt(devs.reduce((a, d) => a + d * d, 0) / devs.length);
      expect(Math.abs(sd - sigma) / sigma).toBeLessThan(0.15);
    }
  });
  it('penalty run-up: on time = full speed, 240 ms late = ×0.875 speed and 1.5° timing σ', () => {
    const on = penalty(1, { x: 2, y: 1 }, 0.8, { offsetMs: 50 });
    const late = penalty(1, { x: 2, y: 1 }, 0.8, { offsetMs: 240 });
    const k1 = on.events.find((e) => e.type === 'kick');
    const k2 = late.events.find((e) => e.type === 'kick');
    if (k1?.type !== 'kick' || k2?.type !== 'kick') throw new Error('no kick');
    expect(k1.timingErrorMs).toBeCloseTo(50, 6);
    expect(k1.scatterDeg).toBe(0);
    expect(k1.launch.speed * 3.6).toBeCloseTo(100, 6);
    expect(k2.timingErrorMs).toBeCloseTo(240, 6);
    expect(k2.scatterDeg).toBeCloseTo(1.5, 9);
    expect(k2.launch.speed * 3.6).toBeCloseTo((40 + 75 * 0.8) * 0.875, 6);
  });
});
