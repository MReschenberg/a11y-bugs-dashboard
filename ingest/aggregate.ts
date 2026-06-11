// Pure aggregation — stats, UTC date keys, event rollups, aging, weekly snapshot.
// No clock access here (all "now"/"asOf" values are passed in) so it stays
// deterministic and unit-testable; run.ts supplies the timestamp.

import {
  type NormalizedBug, type Sev, SEVERITIES, type Stats,
  type EventRollup, type Buckets, BUCKETS, type Aging, type WeeklySnapshot,
} from "./schema";

const DAY = 86_400_000;

export function stats(values: number[]): Stats {
  if (values.length === 0) return { n: 0, min: 0, max: 0, mean: 0, median: 0 };
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const median = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  const mean = s.reduce((a, v) => a + v, 0) / s.length;
  return { n: s.length, min: s[0], max: s[s.length - 1], mean, median };
}

export function ageDays(fromISO: string, toISO: string): number {
  return (Date.parse(toISO) - Date.parse(fromISO)) / DAY;
}

export function monthKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function yearKey(iso: string): string {
  return String(new Date(iso).getUTCFullYear());
}

/** ISO 8601 week key, UTC. Returns "YYYY-Www" using the ISO week-year. */
export function isoWeekKey(iso: string): string {
  const d = new Date(iso);
  const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = dt.getUTCDay() || 7; // Mon=1 … Sun=7
  dt.setUTCDate(dt.getUTCDate() + 4 - day); // shift to the week's Thursday
  const yearStart = Date.UTC(dt.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((dt.getTime() - yearStart) / DAY + 1) / 7);
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function emptySevRecord<T>(init: () => T): Record<Sev, T> {
  const out = {} as Record<Sev, T>;
  for (const s of SEVERITIES) out[s] = init();
  return out;
}
function emptyBuckets(): Buckets {
  const out = {} as Buckets;
  for (const b of BUCKETS) out[b] = 0;
  return out;
}

/** Monthly/yearly event rollups for a bug set (caller pre-filters graveyards/engine). */
export function buildRollups(
  bugs: NormalizedBug[],
  keyFn: (iso: string) => string,
): EventRollup[] {
  const map = new Map<string, EventRollup>();
  const get = (period: string): EventRollup => {
    let r = map.get(period);
    if (!r) {
      r = {
        period,
        filed: 0,
        fixed: 0,
        webaimFiled: 0,
        bySeverity: emptySevRecord(() => ({ filed: 0, fixed: 0 })),
        buckets: emptyBuckets(),
      };
      map.set(period, r);
    }
    return r;
  };

  for (const b of bugs) {
    const filed = get(keyFn(b.created));
    filed.filed++;
    filed.bySeverity[b.severity].filed++;
    if (b.webaim) filed.webaimFiled++;

    // Count a resolution event only when the bug is currently CLOSED. A reopened bug
    // keeps its old cf_last_resolved but is now `open`, so guarding on bucket !== "open"
    // avoids polluting resolution-period buckets with open counts.
    if (b.resolved && b.bucket !== "open") {
      const resolved = get(keyFn(b.resolved));
      resolved.buckets[b.bucket]++;
      if (b.bucket === "fixed") {
        resolved.fixed++;
        resolved.bySeverity[b.severity].fixed++;
      }
    }
  }
  return [...map.values()].sort((a, b) => a.period.localeCompare(b.period));
}

/**
 * Aging (FR-2): time-to-close distribution for FIXED bugs resolved within the
 * trailing window, plus the age of still-open bugs as of `asOf`. Lead with median
 * (the all-time mean is ~9× the median).
 */
export function computeAging(
  bugs: NormalizedBug[],
  asOfISO: string,
  windowMonths: number,
): Aging {
  const start = new Date(asOfISO);
  start.setUTCMonth(start.getUTCMonth() - windowMonths);
  const windowStart = start.getTime();
  const ttc = (b: NormalizedBug) => ageDays(b.created, b.resolved!);

  const inWindow = bugs.filter(
    (b) => b.bucket === "fixed" && b.resolved && Date.parse(b.resolved) >= windowStart,
  );
  const bySeverity = emptySevRecord<Stats>(() => stats([]));
  for (const s of SEVERITIES) {
    bySeverity[s] = stats(inWindow.filter((b) => b.severity === s).map(ttc));
  }
  const open = bugs.filter((b) => b.bucket === "open");
  return {
    windowMonths,
    asOf: asOfISO,
    overall: stats(inWindow.map(ttc)),
    bySeverity,
    openBacklog: stats(open.map((b) => ageDays(b.created, asOfISO))),
  };
}

// The Sunday-23:59:59.999-UTC end of each of the last `count` ISO weeks (oldest→newest);
// the current (in-progress) week is capped at `now`.
function weekEnds(nowISO: string, count: number): { week: string; asOf: string }[] {
  const now = new Date(nowISO);
  const day = now.getUTCDay() || 7; // Mon=1 … Sun=7
  const sunday = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + (7 - day), 23, 59, 59, 999,
  ));
  const out: { week: string; asOf: string }[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const end = new Date(sunday.getTime() - i * 7 * DAY);
    const asOf = end.getTime() > now.getTime() ? now : end; // current week is partial
    out.push({ week: isoWeekKey(asOf.toISOString()), asOf: asOf.toISOString() });
  }
  return out;
}

/**
 * Reconstruct the open backlog as of the end of each of the last `weeks` ISO weeks,
 * purely from timestamps: a bug is open as-of date D iff created ≤ D and (unresolved or
 * resolved after D). Counts and ages are EXACT; the per-severity split uses *current*
 * severity (the documented approximation, since Bugzilla doesn't expose historical
 * attributes). Marked `source: "backfill"`.
 */
export function backfillWeeklySnapshots(
  bugs: NormalizedBug[],
  nowISO: string,
  weeks: number,
): WeeklySnapshot[] {
  return weekEnds(nowISO, weeks).map(({ week, asOf }) => {
    const asOfMs = Date.parse(asOf);
    const open = bugs.filter(
      (b) => Date.parse(b.created) <= asOfMs && (b.resolved === null || Date.parse(b.resolved) > asOfMs),
    );
    const openBySeverity = emptySevRecord(() => 0);
    for (const b of open) openBySeverity[b.severity]++;
    return {
      week,
      capturedAt: nowISO,
      openCount: open.length,
      openBacklog: stats(open.map((b) => ageDays(b.created, asOf))),
      openBySeverity,
      source: "backfill",
    };
  });
}

/** Point-in-time backlog state as of `asOf` for the current (or a backfilled) week. */
export function buildWeeklySnapshot(
  bugs: NormalizedBug[],
  week: string,
  capturedAt: string,
  asOfISO: string,
  source: "snapshot" | "backfill",
): WeeklySnapshot {
  const open = bugs.filter((b) => b.bucket === "open");
  const openBySeverity = emptySevRecord(() => 0);
  for (const b of open) openBySeverity[b.severity]++;
  return {
    week,
    capturedAt,
    openCount: open.length,
    openBacklog: stats(open.map((b) => ageDays(b.created, asOfISO))),
    openBySeverity,
    source,
  };
}
