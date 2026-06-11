import { describe, it, expect } from "vitest";
import { shouldFreeze } from "../snapshot";
import type { WeeklySnapshot } from "../schema";

function snap(week: string): WeeklySnapshot {
  return {
    week, capturedAt: "2026-06-01T00:00:00Z", openCount: 0,
    openBacklog: { n: 0, min: 0, max: 0, mean: 0, median: 0 },
    openBySeverity: { S1: 0, S2: 0, S3: 0, S4: 0, unknown: 0 },
    source: "snapshot",
  };
}

describe("shouldFreeze (weekly point-in-time)", () => {
  it("freezes the prior week's committed current.json when the week has rolled over", () => {
    expect(shouldFreeze(snap("2026-W22"), "2026-W23")).toEqual(snap("2026-W22"));
  });
  it("does nothing within the same week (current.json just gets overwritten)", () => {
    expect(shouldFreeze(snap("2026-W23"), "2026-W23")).toBeNull();
  });
  it("does nothing on the very first run (no prior current.json)", () => {
    expect(shouldFreeze(null, "2026-W23")).toBeNull();
  });
});
