// STUB (Phase 0) — replaced by the physics engineer. Public API is fixed by docs/ARCHITECTURE.md.
import type { LaunchParams, PhysicsEnv, SimulateOptions, Trajectory } from '../contracts';

export function simulate(_launch: LaunchParams, _env: PhysicsEnv, _opts: SimulateOptions = {}): Trajectory {
  return { samples: [], contacts: [], lineCrossing: null };
}
