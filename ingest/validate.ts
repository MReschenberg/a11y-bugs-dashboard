// Runtime validation (R9) — fail loudly rather than publishing silently-wrong data.
// TypeScript types validate nothing at runtime against live Bugzilla, so this guards
// the boundary: unknown enums, missing fields, impossible dates, dup IDs, count drops.

import type { RawBug } from "./schema";
import { isKnownResolution, KNOWN_SEVERITIES } from "./classify";

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export interface ValidateOpts {
  prevTotal?: number;
  dropThreshold?: number; // fractional; default 0.02 (2%)
}

export function validateRawBugs(bugs: RawBug[], opts: ValidateOpts = {}): void {
  if (bugs.length === 0) throw new ValidationError("No bugs returned from BMO.");

  const seen = new Set<number>();
  for (const b of bugs) {
    if (typeof b.id !== "number") {
      throw new ValidationError(`Bug missing numeric id: ${JSON.stringify(b).slice(0, 120)}`);
    }
    if (seen.has(b.id)) throw new ValidationError(`Duplicate bug id ${b.id} (pagination)`);
    seen.add(b.id);

    if (!b.creation_time) throw new ValidationError(`Bug ${b.id} missing creation_time`);
    if (!b.product || !b.component) throw new ValidationError(`Bug ${b.id} missing product/component`);

    if (!isKnownResolution(b.resolution ?? "")) {
      throw new ValidationError(`Bug ${b.id} unknown resolution "${b.resolution}" — add it to §4.4`);
    }
    if (!KNOWN_SEVERITIES.has((b.severity ?? "").toLowerCase())) {
      throw new ValidationError(`Bug ${b.id} unknown severity "${b.severity}" — decide its §4.5 mapping`);
    }
    // NOTE: closed bugs with a missing/invalid resolution date are NOT failed here —
    // they're individually discarded in run.ts (with a ≥5% alert). These are dirty
    // individual records, not a schema problem; failing the whole run on one is wrong.
  }

  const threshold = opts.dropThreshold ?? 0.02;
  if (opts.prevTotal && bugs.length < opts.prevTotal * (1 - threshold)) {
    throw new ValidationError(
      `Bug count dropped >${(threshold * 100).toFixed(0)}% (${opts.prevTotal} → ${bugs.length}); refusing to publish.`,
    );
  }
}
