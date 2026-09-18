import { describe, expect, it } from 'vitest';
import type { Vec3, WorldSnapshot } from '../../src/contracts';
import { CameraRig } from '../../src/render/rig';

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

function world(ball: Vec3, taker: Vec3, t = 0): WorldSnapshot {
  return {
    t,
    ball: { p: ball, w: v(0, 0, 0) },
    keeper: { p: v(0, 0, 0.3), lean: 0, lift: 0, hands: [v(-0.4, 1, 0.4), v(0.4, 1, 0.4)] },
    wall: [],
    defender: null,
    taker: { p: taker, stride: 0 },
  };
}

const close = (a: { x: number; y: number }, b: { x: number; y: number }, eps = 1e-6) => {
  expect(Math.abs(a.x - b.x)).toBeLessThan(eps);
  expect(Math.abs(a.y - b.y)).toBeLessThan(eps);
};

const FK = world(v(4, 0.11, 22), v(3.2, 0, 22.4));
const PK = world(v(0, 0.11, 11), v(-0.6, 0, 11.5));
const dt = 1 / 60;

describe('render camera rig: queries match the frame that is drawn', () => {
  it('title → penalty: the ball position read before the first kick frame equals the drawn one', () => {
    const rig = new CameraRig();
    rig.setSize(1280, 800);
    rig.setCamera('title');
    for (let i = 0; i < 5; i++) rig.frame(FK, dt, dt);
    const titleView = rig.worldToScreen(PK.ball.p);

    // UI: sim.setMode(penalty); scene.setMode(); scene.setCamera('kick'); then reads the ball (no frame yet).
    rig.setMode();
    rig.setCamera('kick');
    const before = rig.worldToScreen(PK.ball.p);
    const rBefore = rig.ballScreenRadius(FK.ball.p, 0.11); // the ball mesh still sits at the old spot
    const goalBefore = rig.screenToGoalPlane(640, 250);
    expect(Math.abs(before.x - titleView.x)).toBeGreaterThan(50); // it is not the stale title projection

    rig.frame(PK, 0, dt);
    const after = rig.worldToScreen(PK.ball.p);
    close(before, after);
    expect(Math.abs(rBefore - rig.ballScreenRadius(PK.ball.p, 0.11))).toBeLessThan(1e-6);
    const goalAfter = rig.screenToGoalPlane(640, 250);
    expect(goalBefore).not.toBeNull();
    expect(goalAfter).not.toBeNull();
    if (goalBefore && goalAfter) close(goalBefore, goalAfter);
    // Ball in the lower-middle of a 1280×800 screen.
    expect(after.x).toBeGreaterThan(450);
    expect(after.x).toBeLessThan(700);
    expect(after.y).toBeCloseTo(620, 0);

    // Later frames do not move it.
    for (let i = 0; i < 30; i++) rig.frame(PK, dt, dt);
    close(rig.worldToScreen(PK.ball.p), after);
  });

  it('replay → back with the ball in the net: queries before and after the next frame agree', () => {
    const rig = new CameraRig();
    rig.setSize(1280, 800);
    rig.setMode();
    for (let i = 0; i < 5; i++) rig.frame(PK, dt, dt);
    const spotView = rig.worldToScreen(PK.ball.p);
    const inNet = world(v(-2.5, 0.11, -1.4), PK.taker.p);
    rig.setCamera('replay');
    rig.setPath([PK.ball.p, v(-1.2, 1.2, 5), v(-2.5, 1.8, 0), inNet.ball.p]);
    for (let i = 0; i < 20; i++) rig.frame(inNet, dt * 0.35, dt);
    rig.setMode();
    rig.setCamera('kick');
    const before = rig.worldToScreen(inNet.ball.p);
    const spotBefore = rig.worldToScreen(PK.ball.p);
    rig.frame(inNet, 0, dt);
    close(before, rig.worldToScreen(inNet.ball.p));
    close(spotBefore, rig.worldToScreen(PK.ball.p));
    // The camera stayed behind the penalty spot (did not jump onto the ball in the net).
    close(rig.worldToScreen(PK.ball.p), spotView);
  });

  it('title camera is applied immediately on setCamera', () => {
    const rig = new CameraRig();
    rig.setSize(1280, 800);
    rig.setMode();
    rig.frame(PK, dt, dt);
    rig.setCamera('title');
    const before = rig.worldToScreen(v(0, 1.2, 0));
    rig.frame(PK, 0, 0);
    close(before, rig.worldToScreen(v(0, 1.2, 0)));
  });
});
