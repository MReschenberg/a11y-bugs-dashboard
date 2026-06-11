// Pure classification — the §4.4 (resolution) and §4.5 (severity) tables from the
// plan, finalized from the Step 0 audit + sensitivity analysis. Kept in one place
// so the policy choices are a one-line change and unit-testable.

import type { Sev, Bucket, ClosedBucket, RawBug, NormalizedBug } from "./schema";

// §4.5 normalized severity. `major→S3` is validated by the sensitivity analysis
// (major closes like S3, median 38d, not S2's 28d). `unknown` is kept separate and
// never folded into an S. The UI must label this "normalized severity" + show raw.
const SEVERITY_MAP: Record<string, Sev> = {
  s1: "S1", blocker: "S1",
  s2: "S2", critical: "S2",
  s3: "S3", major: "S3", normal: "S3",
  s4: "S4", minor: "S4", trivial: "S4",
};

// Raw severity values we have consciously accounted for. The validator FAILS on any
// value outside this set, so a new Bugzilla severity forces a deliberate mapping
// decision rather than silently becoming "unknown".
export const KNOWN_SEVERITIES = new Set<string>([
  ...Object.keys(SEVERITY_MAP),
  "--", "n/a", "", "enhancement",
]);

export function mapSeverity(raw: string | null | undefined): Sev {
  return SEVERITY_MAP[(raw ?? "").toLowerCase()] ?? "unknown";
}

// §4.4 resolution buckets (counts confirmed against the live population in Step 0).
const RESOLUTION_MAP: Record<string, ClosedBucket> = {
  FIXED: "fixed",
  WONTFIX: "wontfix",
  INCOMPLETE: "incomplete",
  INACTIVE: "incomplete",
  DUPLICATE: "duplicate",
  INVALID: "invalid",
  WORKSFORME: "invalid",
  EXPIRED: "other_closed",
  MOVED: "other_closed",
};

export function isKnownResolution(resolution: string): boolean {
  return resolution === "" || resolution in RESOLUTION_MAP;
}

export function classifyResolution(resolution: string): Bucket {
  if (!resolution) return "open";
  return RESOLUTION_MAP[resolution] ?? "other_closed";
}

/** Graveyard = archived product. */
export function isGraveyard(product: string): boolean {
  return /graveyard/i.test(product);
}

// Products excluded from the dashboard population: archived (graveyard) plus the
// Thunderbird/SeaMonkey family — Thunderbird, SeaMonkey, MailNews Core, Calendar
// (per Morgan — out of scope for this report).
const EXCLUDED_PRODUCTS = new Set(["Thunderbird", "SeaMonkey", "MailNews Core", "Calendar"]);
export function isExcludedProduct(product: string): boolean {
  return isGraveyard(product) || EXCLUDED_PRODUCTS.has(product);
}

/** The a11y engine itself (`Core :: Disability Access*`), shown as a flagged series (R13). */
export function isEngine(product: string, component: string): boolean {
  return product === "Core" && /disability access/i.test(component);
}

// WebAIM contractor — bulk a11y-audit filings are attributed to him and flagged in
// the UI so a single audit batch isn't misread as organic intake.
export const WEBAIM_CONTRACTOR = "john.northup@usu.edu";
export function isWebaim(creator: string | null | undefined): boolean {
  return (creator ?? "").toLowerCase() === WEBAIM_CONTRACTOR;
}

export function normalizeBug(b: RawBug): NormalizedBug {
  return {
    id: b.id,
    created: b.creation_time,
    resolved: b.cf_last_resolved ?? null,
    severity: mapSeverity(b.severity),
    bucket: classifyResolution(b.resolution),
    product: b.product,
    component: b.component,
    excluded: isExcludedProduct(b.product),
    isEngine: isEngine(b.product, b.component),
    webaim: isWebaim(b.creator),
    restricted: !!(b.groups && b.groups.length > 0),
  };
}
