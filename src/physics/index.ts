// LT26 physics — public entry points (docs/ARCHITECTURE.md §3). Pure, deterministic, no Three.js, no DOM.
export * from './constants';
export {
  acceleration,
  dragCoefficient,
  launchState,
  liftCoefficient,
  simulate,
  spinVector,
  stepBall,
  type PhysicsSimulateOptions,
} from './ball';
export { collideCollider, collideGround, goalFrameColliders, type CollisionResult } from './collisions';
export { createKnuckleNoise, gaussian, mulberry32, type KnuckleNoise } from './rng';
export { solveLaunch } from './solver';
