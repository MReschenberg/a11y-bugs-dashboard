import { describe, it, expect } from "vitest";
import {
  stats, ageDays, monthKey, yearKey, isoWeekKey,
  buildRollups, computeAging, buildWeeklySnapshot, backfillWeeklySnapshots,
} from "../aggregate";
import type { NormalizedBug } from "../schema";

function bug(p: Partial<NormalizedBug>): NormalizedBug {
  return {
    id: 0, created: "2026-01-01T00:00:00Z", resolved: null, severity: "S3",
    bucket: "open", product: "Core", component: "X",
    excluded: false, brokenOut: false, webaim: false, restricted: false, ...p,
  };
}

describe("stats", () => {
  it("handles empty", () => {
    expect(stats([])).toEqual({ n: 0, min: 0, max: 0, mean: 0, median: 0 });
  });
  it("odd-length median", () => {
    expect(stats([3, 1, 2])).toMatchObject({ n: 3, min: 1, max: 3, median: 2, mean: 2 });
  });
  it("even-length median averages the middle two", () => {
    expect(stats([1, 2, 3, 4]).median).toBe(2.5);
  });
});

describe("UTC date keys (date-boundary fixture)", () => {
  it("buckets by UTC, not local time, at month edges", () => {
    // 23:59 UTC on the last day stays in that month; 00:00 next day rolls over.
    expect(monthKey("2026-12-31T23:59:59Z")).toBe("2026-12");
    expect(monthKey("2027-01-01T00:00:00Z")).toBe("2027-01");
    expect(yearKey("2026-12-31T23:59:59Z")).toBe("2026");
    expect(yearKey("2027-01-01T00:00:00Z")).toBe("2027");
  });
  it("computes ISO week-year correctly, incl. year-boundary weeks", () => {
    // 2026-01-01 is a Thursday → ISO 2026-W01.
    expect(isoWeekKey("2026-01-01T12:00:00Z")).toBe("2026-W01");
    // 2021-01-01 is a Friday → belongs to ISO 2020-W53.
    expect(isoWeekKey("2021-01-01T12:00:00Z")).toBe("2020-W53");
  });
});

describe("ageDays", () => {
  it("computes whole-day differences", () => {
    expect(ageDays("2026-01-01T00:00:00Z", "2026-01-08T00:00:00Z")).toBe(7);
  });
});

describe("buildRollups", () => {
  const bugs: NormalizedBug[] = [
    bug({ id: 1, created: "2026-01-10T00:00:00Z", resolved: "2026-02-05T00:00:00Z", bucket: "fixed", severity: "S2" }),
    bug({ id: 2, created: "2026-01-20T00:00:00Z", bucket: "open", severity: "S3" }),
    bug({ id: 3, created: "2026-02-01T00:00:00Z", resolved: "2026-02-15T00:00:00Z", bucket: "duplicate", severity: "S3" }),
  ];
  const monthly = buildRollups(bugs, monthKey);

  it("counts filed by creation month and fixed by resolution month", () => {
    const jan = monthly.find((r) => r.period === "2026-01")!;
    const feb = monthly.find((r) => r.period === "2026-02")!;
    expect(jan.filed).toBe(2); // bugs 1 & 2 created in Jan
    expect(feb.filed).toBe(1); // bug 3 created in Feb
    expect(feb.fixed).toBe(1); // only bug 1 is FIXED, resolved in Feb
  });
  it("splits closed outcomes into buckets (duplicate not counted as fixed)", () => {
    const feb = monthly.find((r) => r.period === "2026-02")!;
    expect(feb.buckets.fixed).toBe(1);
    expect(feb.buckets.duplicate).toBe(1);
    expect(feb.fixed).toBe(1);
  });
  it("tracks per-severity filed/fixed", () => {
    const feb = monthly.find((r) => r.period === "2026-02")!;
    expect(feb.bySeverity.S2.fixed).toBe(1);
  });
  it("returns periods in chronological order", () => {
    expect(monthly.map((r) => r.period)).toEqual(["2026-01", "2026-02"]);
  });
  it("counts WebAIM-filed bugs per filing month", () => {
    const withWebaim = buildRollups(
      [
        bug({ id: 10, created: "2026-03-01T00:00:00Z", webaim: true }),
        bug({ id: 11, created: "2026-03-02T00:00:00Z", webaim: true }),
        bug({ id: 12, created: "2026-03-03T00:00:00Z", webaim: false }),
      ],
      monthKey,
    );
    const mar = withWebaim.find((r) => r.period === "2026-03")!;
    expect(mar.filed).toBe(3);
    expect(mar.webaimFiled).toBe(2);
  });
});

describe("computeAging", () => {
  const asOf = "2026-06-30T00:00:00Z";
  const bugs: NormalizedBug[] = [
    // FIXED within window (resolved May 2026): TTC ~30 days
    bug({ id: 1, created: "2026-04-01T00:00:00Z", resolved: "2026-05-01T00:00:00Z", bucket: "fixed", severity: "S2" }),
    // FIXED but OUTSIDE the 6-month window (resolved long ago): excluded
    bug({ id: 2, created: "2020-01-01T00:00:00Z", resolved: "2020-02-01T00:00:00Z", bucket: "fixed", severity: "S2" }),
    // Open since 2024: contributes to backlog age, not TTC
    bug({ id: 3, created: "2024-06-30T00:00:00Z", bucket: "open", severity: "S3" }),
  ];
  const aging = computeAging(bugs, asOf, 6);

  it("includes only FIXED bugs resolved within the trailing window", () => {
    expect(aging.overall.n).toBe(1);
    expect(aging.overall.median).toBe(30);
  });
  it("reports per-severity stats", () => {
    expect(aging.bySeverity.S2.n).toBe(1);
    expect(aging.bySeverity.S3.n).toBe(0);
  });
  it("ages the open backlog as of asOf", () => {
    expect(aging.openBacklog.n).toBe(1);
    expect(aging.openBacklog.median).toBeCloseTo(730, 0); // ~2 years open
  });
});

describe("buildWeeklySnapshot", () => {
  const asOf = "2026-06-30T00:00:00Z";
  const bugs: NormalizedBug[] = [
    bug({ id: 1, created: "2026-06-01T00:00:00Z", bucket: "open", severity: "S2" }),
    bug({ id: 2, created: "2026-06-01T00:00:00Z", bucket: "open", severity: "unknown" }),
    bug({ id: 3, created: "2026-06-01T00:00:00Z", resolved: "2026-06-10T00:00:00Z", bucket: "fixed", severity: "S2" }),
  ];
  it("captures open backlog state, not closed bugs", () => {
    const snap = buildWeeklySnapshot(bugs, "2026-W27", asOf, asOf, "snapshot");
    expect(snap.openCount).toBe(2);
    expect(snap.openBySeverity.S2).toBe(1);
    expect(snap.openBySeverity.unknown).toBe(1);
    expect(snap.openBacklog.n).toBe(2);
    expect(snap.source).toBe("snapshot");
  });
});

describe("backfillWeeklySnapshots", () => {
  // A bug open Jan–Mar 2026: created 2026-01-01, resolved (fixed) 2026-03-15.
  const bugs: NormalizedBug[] = [
    bug({ id: 1, created: "2026-01-01T00:00:00Z", resolved: "2026-03-15T00:00:00Z", bucket: "fixed" }),
    bug({ id: 2, created: "2026-02-01T00:00:00Z", bucket: "open" }), // still open
  ];
  const series = backfillWeeklySnapshots(bugs, "2026-06-01T00:00:00Z", 30);

  it("produces one entry per week (oldest→newest), marked backfill", () => {
    expect(series.length).toBe(30);
    expect(series.every((s) => s.source === "backfill")).toBe(true);
    expect(series.map((s) => s.week)).toEqual([...series.map((s) => s.week)].sort());
  });
  it("counts a bug as open only between its creation and resolution dates", () => {
    const wk = (s: string) => series.find((x) => x.week === s);
    // mid-Feb: both bugs open (bug1 not yet resolved, bug2 created); mid-Apr: only bug2.
    const feb = series.find((s) => s.week >= "2026-W07" && s.week <= "2026-W08");
    const apr = series.find((s) => s.week >= "2026-W16" && s.week <= "2026-W17");
    expect(feb && feb.openCount).toBe(2);
    expect(apr && apr.openCount).toBe(1);
    // sanity: an early-January week has only bug1 open
    const jan1 = wk("2026-W01");
    expect(jan1 && jan1.openCount).toBe(1);
  });
});
