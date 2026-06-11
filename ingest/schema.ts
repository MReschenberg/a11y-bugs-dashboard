// Shared types — the contract between the ingestion writer and the front-end reader.
// Two grains, kept deliberately separate (see plan §4.2 / §4.6):
//   • WeeklySnapshot = point-in-time STATE (open backlog), frozen per ISO week.
//   • EventRollup    = EVENTS (filed/fixed), reconstructable from timestamps.

export type Sev = "S1" | "S2" | "S3" | "S4" | "unknown";
export const SEVERITIES: readonly Sev[] = ["S1", "S2", "S3", "S4", "unknown"];

export type ClosedBucket =
  | "fixed" | "wontfix" | "incomplete" | "duplicate" | "invalid" | "other_closed";
export type Bucket = ClosedBucket | "open";
export const BUCKETS: readonly Bucket[] = [
  "fixed", "wontfix", "incomplete", "duplicate", "invalid", "other_closed", "open",
];
export type Buckets = Record<Bucket, number>;

/** Raw bug as returned by the Bugzilla REST API (only the fields we request). */
export interface RawBug {
  id: number;
  creation_time: string;
  cf_last_resolved?: string | null;
  last_change_time?: string;
  status: string;
  resolution: string; // "" when open
  dupe_of?: number | null;
  severity?: string | null;
  keywords?: string[];
  product: string;
  component: string;
  creator?: string; // reporter login (used only to flag WebAIM batches; never published)
  groups?: string[]; // non-empty ⇒ security-restricted (R15)
}

/** Internal normalized shape after classification. */
export interface NormalizedBug {
  id: number;
  created: string;          // ISO
  resolved: string | null;  // ISO or null
  severity: Sev;            // normalized (§4.5)
  bucket: Bucket;           // resolution bucket (§4.4)
  product: string;
  component: string;
  excluded: boolean; // graveyard / Thunderbird / SeaMonkey — out of the population
  isEngine: boolean;
  webaim: boolean;   // filed by the WebAIM contractor
  restricted: boolean;
}

export interface Stats {
  n: number;
  min: number;
  max: number;
  mean: number;
  median: number;
}

/** (A) Point-in-time state — one frozen file per closed ISO week + live current.json. */
export interface WeeklySnapshot {
  week: string;            // "2026-W23" (ISO week, UTC)
  capturedAt: string;      // when this week's aggregate was captured
  openCount: number;
  openBacklog: Stats;      // age (days) of still-open bugs as of capture
  openBySeverity: Record<Sev, number>;
  source: "snapshot" | "backfill";
}

/** (B) Events — reconstructable from timestamps; drives FR-1/FR-3. */
export interface EventRollup {
  period: string;          // "2026-05" (month) or "2026" (year), UTC/calendar
  filed: number;
  fixed: number;
  webaimFiled: number;     // of `filed`, how many were the WebAIM contractor's
  bySeverity: Record<Sev, { filed: number; fixed: number }>;
  buckets: Buckets;        // closed-outcome split for resolutions in-period
}

export interface RollupsFile {
  monthly: EventRollup[];
  yearly: EventRollup[];
  engineMonthly: EventRollup[]; // a11y-engine-only, flagged series (R13)
  engineYearly: EventRollup[];
}

/** Open-backlog state over time (FR-2 trend): one entry per ISO week. */
export interface BacklogFile {
  weeks: WeeklySnapshot[]; // chronological; frozen where available, else reconstructed
}

export interface Aging {
  windowMonths: number;
  asOf: string;
  overall: Stats;
  bySeverity: Record<Sev, Stats>;
  openBacklog: Stats;
}

export interface Meta {
  generatedAt: string;
  lastSuccessfulIngest: string;
  totalBugs: number;        // population shown (after exclusions)
  totalFetched: number;     // raw fetched (incl. excluded)
  excludedCount: number;    // graveyard + Thunderbird + SeaMonkey
  excludedDetail: Record<string, number>;
  engineCount: number;
  restrictedCount: number;
  webaimTotal: number;      // bugs filed by the WebAIM contractor (shown population; count only)
  rawSeverityCounts: Record<string, number>; // audits the §4.5 normalization (R14)
  caveats: string[];
  bmoQueryBase: string;     // for query-link provenance (no bug IDs — R15)
}
