// Per-spot session statistics, persisted in localStorage (key 'lt26.log.v1').
import type { Mode, SessionLog, ShotResult, ShotSummary, SpotStats, Vec3 } from '../contracts';

export const LOG_KEY = 'lt26.log.v1';

const GOAL_HALF_WIDTH = 3.66;
const GOAL_HEIGHT = 2.44;
const MODES: readonly Mode[] = ['freeKick', 'penalty', 'longShot'];
const RESULTS: readonly ShotResult[] = ['goal', 'saved', 'caught', 'post', 'bar', 'wall', 'miss'];

interface StoredSpot {
  spotKey: string;
  mode: Mode;
  attempts: number;
  goals: number;
  missSum: number;
  missCount: number;
  best: ShotSummary | null;
}

interface StoredLog {
  v: 1;
  spots: Record<string, StoredSpot>;
}

/** Distance from where a goal crossed the line to the nearest inner corner of the goal mouth. */
export function cornerDistance(s: ShotSummary): number {
  if (!s.crossing) return Infinity;
  const dx = GOAL_HALF_WIDTH - Math.abs(s.crossing.x);
  const dy = Math.min(s.crossing.y, GOAL_HEIGHT - s.crossing.y);
  return Math.hypot(dx, dy);
}

/** True if `a` is a better "best kick" than `b`: goals beat non-goals; goals nearer a corner win; else smaller miss. */
export function isBetterKick(a: ShotSummary, b: ShotSummary | null): boolean {
  if (!b) return true;
  const ag = a.result === 'goal';
  const bg = b.result === 'goal';
  if (ag !== bg) return ag;
  if (ag) return cornerDistance(a) < cornerDistance(b);
  return a.missDistanceM < b.missDistanceM;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isVec = (v: unknown): v is Vec3 => {
  const o = v as Vec3 | null;
  return !!o && typeof o === 'object' && isNum(o.x) && isNum(o.y) && isNum(o.z);
};

function validSummary(v: unknown): v is ShotSummary {
  const s = v as ShotSummary | null;
  if (!s || typeof s !== 'object') return false;
  const crossingOk =
    s.crossing === null || (typeof s.crossing === 'object' && isNum(s.crossing.x) && isNum(s.crossing.y));
  return (
    MODES.includes(s.mode) &&
    typeof s.spotKey === 'string' &&
    RESULTS.includes(s.result) &&
    isNum(s.speedKmh) &&
    isNum(s.spinRps) &&
    isNum(s.lateralCurveM) &&
    isNum(s.apexM) &&
    isNum(s.timeToGoalS) &&
    isNum(s.missDistanceM) &&
    crossingOk &&
    Array.isArray(s.path) &&
    s.path.every(isVec)
  );
}

function validSpot(key: string, v: unknown): StoredSpot | null {
  const s = v as StoredSpot | null;
  if (!s || typeof s !== 'object') return null;
  if (s.spotKey !== key || !MODES.includes(s.mode)) return null;
  if (![s.attempts, s.goals, s.missSum, s.missCount].every((n) => isNum(n) && n >= 0)) return null;
  if (s.goals > s.attempts || s.missCount > s.attempts) return null;
  const best = s.best === null || validSummary(s.best) ? s.best : null;
  return {
    spotKey: key,
    mode: s.mode,
    attempts: s.attempts,
    goals: s.goals,
    missSum: s.missSum,
    missCount: s.missCount,
    best,
  };
}

function load(storage: Storage | null): StoredLog {
  const empty: StoredLog = { v: 1, spots: {} };
  if (!storage) return empty;
  try {
    const raw = storage.getItem(LOG_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<StoredLog> | null;
    if (!parsed || typeof parsed !== 'object' || parsed.v !== 1 || !parsed.spots || typeof parsed.spots !== 'object') {
      return empty;
    }
    const spots: Record<string, StoredSpot> = {};
    for (const [k, v] of Object.entries(parsed.spots)) {
      const s = validSpot(k, v);
      if (s) spots[k] = s;
    }
    return { v: 1, spots };
  } catch {
    return empty;
  }
}

const r3 = (n: number): number => Math.round(n * 1000) / 1000;

function compact(s: ShotSummary): ShotSummary {
  return {
    ...s,
    crossing: s.crossing ? { x: s.crossing.x, y: s.crossing.y } : null,
    path: s.path.map((p) => ({ x: r3(p.x), y: r3(p.y), z: r3(p.z) })),
  };
}

function toStats(s: StoredSpot): SpotStats {
  return {
    spotKey: s.spotKey,
    mode: s.mode,
    attempts: s.attempts,
    goals: s.goals,
    avgMissM: s.missCount > 0 ? s.missSum / s.missCount : 0,
    best: s.best,
  };
}

export function createSessionLog(storage: Storage | null): SessionLog {
  let data = load(storage);

  const save = (): void => {
    if (!storage) return;
    try {
      storage.setItem(LOG_KEY, JSON.stringify(data));
    } catch {
      /* quota exceeded or storage blocked: statistics stay in memory for this session */
    }
  };

  return {
    record(s: ShotSummary): SpotStats {
      const prev = data.spots[s.spotKey];
      const spot: StoredSpot =
        prev && prev.mode === s.mode
          ? prev
          : { spotKey: s.spotKey, mode: s.mode, attempts: 0, goals: 0, missSum: 0, missCount: 0, best: null };
      spot.attempts += 1;
      if (s.result === 'goal') spot.goals += 1;
      else if (Number.isFinite(s.missDistanceM)) {
        spot.missSum += s.missDistanceM;
        spot.missCount += 1;
      }
      if (isBetterKick(s, spot.best)) spot.best = compact(s);
      data.spots[s.spotKey] = spot;
      save();
      return toStats(spot);
    },
    get(spotKey: string): SpotStats | null {
      const s = data.spots[spotKey];
      return s ? toStats(s) : null;
    },
    all(): SpotStats[] {
      return Object.values(data.spots)
        .sort((a, b) => MODES.indexOf(a.mode) - MODES.indexOf(b.mode) || a.spotKey.localeCompare(b.spotKey))
        .map(toStats);
    },
    reset(): void {
      data = { v: 1, spots: {} };
      if (!storage) return;
      try {
        storage.removeItem(LOG_KEY);
      } catch {
        /* storage blocked: the in-memory log is already empty */
      }
    },
  };
}
