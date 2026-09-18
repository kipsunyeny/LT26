// STUB (Phase 0) — replaced by the gameplay/sim engineer.
import type { SessionLog } from '../contracts';

export function createSessionLog(_storage: Storage | null): SessionLog {
  return {
    record: () => ({ spotKey: '', mode: 'freeKick', attempts: 0, goals: 0, avgMissM: 0, best: null }),
    get: () => null,
    all: () => [],
    reset() {},
  };
}
