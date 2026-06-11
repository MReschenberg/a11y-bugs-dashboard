// Data layer: load the precomputed JSON and small shared helpers. Types come from
// the ingestion schema so the contract is single-sourced.
import type {
  Meta, RollupsFile, Aging, WeeklySnapshot, EventRollup, Sev, Stats, Bucket, BacklogFile,
} from "../ingest/schema";

export type { Meta, RollupsFile, Aging, WeeklySnapshot, EventRollup, Sev, Stats, Bucket, BacklogFile };

export const SEVS: readonly Sev[] = ["S1", "S2", "S3", "S4", "unknown"];

// A month is marked with `*` when the WebAIM contractor filed at least this many
// bugs in it — so an audit batch isn't misread as organic intake.
export const WEBAIM_SPIKE_MIN = 10;

export interface DashboardData {
  meta: Meta;
  rollups: RollupsFile;
  aging: Aging;
  current: WeeklySnapshot;
  backlog: BacklogFile;
}

// Vite injects BASE_URL; fall back to "/" when imported outside Vite (e.g. tests).
const BASE = import.meta.env?.BASE_URL ?? "/";

async function getJson<T>(name: string): Promise<T> {
  const res = await fetch(`${BASE}data/${name}`);
  if (!res.ok) throw new Error(`Failed to load ${name}: ${res.status}`);
  return (await res.json()) as T;
}

export async function loadData(): Promise<DashboardData> {
  const [meta, rollups, aging, current, backlog] = await Promise.all([
    getJson<Meta>("meta.json"),
    getJson<RollupsFile>("rollups.json"),
    getJson<Aging>("aging.json"),
    getJson<WeeklySnapshot>("current.json"),
    getJson<BacklogFile>("backlog.json"),
  ]);
  return { meta, rollups, aging, current, backlog };
}

/** ISO week key ("YYYY-Www") → the Monday of that ISO week, for plotting on a time axis. */
export function isoWeekToDate(weekKey: string): Date {
  const [y, w] = weekKey.split("-W").map(Number);
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Monday = jan4.getTime() - (jan4Day - 1) * 86_400_000;
  return new Date(week1Monday + (w - 1) * 7 * 86_400_000);
}

// Normalized → raw Bugzilla severities (inverse of classify.ts §4.5). Used for the
// raw-severity audit table and to expand provenance links (a normalized S3 must
// query S3 OR major OR normal).
export const NORM_TO_RAW: Record<Sev, string[]> = {
  S1: ["S1", "blocker"],
  S2: ["S2", "critical"],
  S3: ["S3", "major", "normal"],
  S4: ["S4", "minor", "trivial"],
  unknown: ["--", "N/A", "enhancement"],
};

export const SEV_LABEL: Record<Sev, string> = {
  S1: "S1", S2: "S2", S3: "S3", S4: "S4", unknown: "Unknown",
};

export const BUCKET_LABEL: Record<string, string> = {
  fixed: "Fixed", wontfix: "Won't fix", incomplete: "Incomplete",
  duplicate: "Duplicate", invalid: "Invalid / WFM", other_closed: "Other closed", open: "Open",
};

/**
 * Build a Bugzilla buglist provenance link. Query-links ONLY — we never emit bug
 * IDs (R15), so this is safe even though the population includes restricted bugs:
 * each viewer sees only what they're authorized to. Links are approximate (no date
 * bounds; graveyards not excluded) — see the About section.
 */
export function bmoLink(opts: { resolutions?: string[]; severities?: Sev[] } = {}): string {
  const u = new URL("https://bugzilla.mozilla.org/buglist.cgi");
  u.searchParams.set("keywords", "access");
  u.searchParams.set("keywords_type", "allwords");
  for (const r of opts.resolutions ?? []) u.searchParams.append("resolution", r);
  for (const s of opts.severities ?? []) {
    for (const raw of NORM_TO_RAW[s]) u.searchParams.append("bug_severity", raw);
  }
  return u.toString();
}

const DAY = 86_400_000;
export const daysSince = (iso: string): number => (Date.now() - Date.parse(iso)) / DAY;

export const fmt = {
  int: (n: number): string => Math.round(n).toLocaleString("en-US"),
  days: (n: number): string => `${Math.round(n).toLocaleString("en-US")}d`,
  delta: (n: number): string =>
    n > 0 ? `+${Math.round(n).toLocaleString("en-US")}` : Math.round(n).toLocaleString("en-US"),
};

/** Filter monthly rollups to periods >= `fromPeriod` ("YYYY-MM"); lexicographic is safe. */
export function sinceMonth(rollups: EventRollup[], fromPeriod: string): EventRollup[] {
  return rollups.filter((r) => r.period >= fromPeriod);
}

/** Sum a metric over the selected normalized severities for one rollup period. */
export function sumSelected(r: EventRollup, metric: "filed" | "fixed", sevs: readonly Sev[]): number {
  return sevs.reduce((acc, s) => acc + r.bySeverity[s][metric], 0);
}
