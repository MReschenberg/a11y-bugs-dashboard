// Weekly freeze logic (plan §4.2). Point-in-time semantics: a closed week is frozen
// from the LAST COMMITTED current.json — never recomputed from live Bugzilla, which
// would let already-frozen history shift when bugs are relabeled.

import type { WeeklySnapshot } from "./schema";

/**
 * Given the previously committed `current.json` and the ISO week of *this* run,
 * return the snapshot that should be frozen (promoted to snapshots/<week>.json), or
 * null if nothing has closed since last run. The caller writes it only if a frozen
 * file for that week doesn't already exist (freeze-once).
 */
export function shouldFreeze(
  prevCurrent: WeeklySnapshot | null,
  currentWeek: string,
): WeeklySnapshot | null {
  if (prevCurrent && prevCurrent.week !== currentWeek) return prevCurrent;
  return null;
}
