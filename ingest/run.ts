// Ingestion orchestrator (plan §9 step 3). Runs in GitHub Actions (or locally):
// fetch → validate → normalize → aggregate → freeze prior ISO week → write JSON.
// This is the one place allowed to read the clock; pure aggregation receives `now`.

import { writeFile, readFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAccessBugs } from "./fetchBugs";
import { validateRawBugs, ValidationError } from "./validate";
import { normalizeBug, isGraveyard, isExcludedProduct } from "./classify";
import {
  buildRollups, monthKey, yearKey, isoWeekKey, computeAging, buildWeeklySnapshot,
  backfillWeeklySnapshots,
} from "./aggregate";
import { shouldFreeze } from "./snapshot";
import type { Meta, WeeklySnapshot, RollupsFile, NormalizedBug } from "./schema";

// Load .env for local runs (gitignored; CI uses an Actions secret instead).
try {
  (process as NodeJS.Process & { loadEnvFile?: (p?: string) => void }).loadEnvFile?.(".env");
} catch {
  /* no .env — fine, run public-only */
}

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, "..", "public", "data");
const SNAP = join(DATA, "snapshots");
const WINDOW_MONTHS = 6;
const BACKLOG_WEEKS = 104; // ~2 years of weekly open-backlog history

async function readFrozenSnapshots(): Promise<Map<string, WeeklySnapshot>> {
  const map = new Map<string, WeeklySnapshot>();
  try {
    for (const f of await readdir(SNAP)) {
      if (!f.endsWith(".json")) continue;
      const snap = await readJson<WeeklySnapshot>(join(SNAP, f));
      if (snap) map.set(snap.week, snap);
    }
  } catch {
    /* no frozen snapshots yet */
  }
  return map;
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const now = new Date().toISOString();
  await mkdir(SNAP, { recursive: true });

  const prevMeta = await readJson<Meta>(join(DATA, "meta.json"));
  const prevCurrent = await readJson<WeeklySnapshot>(join(DATA, "current.json"));

  console.error("Fetching `access` bugs from BMO…");
  const { bugs, totalMatches, usedKey } = await fetchAccessBugs((m) =>
    process.stderr.write(`  ${m}\r`),
  );
  process.stderr.write("\n");

  if (totalMatches != null && bugs.length < totalMatches) {
    throw new ValidationError(`Incomplete fetch: got ${bugs.length} of ${totalMatches} matches`);
  }
  validateRawBugs(bugs, { prevTotal: prevMeta?.totalFetched });

  const normalized = bugs.map(normalizeBug);
  const active = normalized.filter((b) => !b.excluded); // graveyard + Thunderbird family excluded

  // Discard bugs that can't be resolved cleanly: closed (not open) but with a missing
  // or impossible resolution date — we can't place them in time, so they're dropped
  // entirely rather than half-counted. Alert only if they exceed ~5% of the population.
  const isDirty = (b: NormalizedBug): boolean =>
    b.bucket !== "open" && (b.resolved === null || !(Date.parse(b.resolved) >= Date.parse(b.created)));
  const dirty = active.filter(isDirty);
  const clean = active.filter((b) => !isDirty(b));
  if (dirty.length > 0) {
    const pct = (dirty.length / active.length) * 100;
    const msg = `Discarded ${dirty.length} bug(s) (${pct.toFixed(2)}%) that can't be cleanly resolved — closed but missing/invalid resolution date.`;
    if (pct > 5) console.warn(`⚠ ALERT: ${msg} Exceeds 5% — investigate the data source.`);
    else console.error(`  ${msg}`);
  }

  // Restricted bugs are kept ONLY as a coarse total (meta.restrictedCount); they are
  // excluded from every fine-grained output so they can't be localized by subtracting
  // public-only Bugzilla counts (R15 small-cell mitigation).
  const published = clean.filter((b) => !b.restricted);
  const engine = published.filter((b) => b.isEngine);

  // Breakdown of why bugs were excluded (graveyards collapsed; named products kept distinct).
  const excludedDetail: Record<string, number> = {};
  for (const b of bugs) {
    if (!isExcludedProduct(b.product)) continue;
    const key = isGraveyard(b.product) ? "graveyard" : b.product;
    excludedDetail[key] = (excludedDetail[key] ?? 0) + 1;
  }

  // Raw-severity tally over the shown (active) population — lets the UI audit the
  // normalized S1–S4 mapping (R14). Keyed by the raw Bugzilla value.
  const rawSeverityCounts: Record<string, number> = {};
  for (const b of bugs) {
    if (isExcludedProduct(b.product) || (b.groups && b.groups.length > 0)) continue; // skip excluded + restricted
    const key = b.severity || "--";
    rawSeverityCounts[key] = (rawSeverityCounts[key] ?? 0) + 1;
  }

  const rollups: RollupsFile = {
    monthly: buildRollups(published, monthKey),
    yearly: buildRollups(published, yearKey),
    engineMonthly: buildRollups(engine, monthKey),
    engineYearly: buildRollups(engine, yearKey),
  };
  const aging = computeAging(published, now, WINDOW_MONTHS);

  const currentWeek = isoWeekKey(now);
  const snapshot = buildWeeklySnapshot(published, currentWeek, now, now, "snapshot");

  // Freeze the prior week from the committed current.json (point-in-time, freeze-once).
  const toFreeze = shouldFreeze(prevCurrent, currentWeek);
  if (toFreeze) {
    const frozenPath = join(SNAP, `${toFreeze.week}.json`);
    if (!existsSync(frozenPath)) {
      await writeFile(frozenPath, JSON.stringify(toFreeze, null, 2));
    }
  }

  // Backlog trend: reconstruct ~2 years of weekly open-backlog state from timestamps,
  // overlay any frozen weekly snapshots (authoritative point-in-time), and pin the live
  // current week. Written as one file the static client loads (no per-week fetches).
  const frozen = await readFrozenSnapshots();
  const backlogWeeks = backfillWeeklySnapshots(published, now, BACKLOG_WEEKS)
    .map((s) => frozen.get(s.week) ?? s);
  const curIdx = backlogWeeks.findIndex((s) => s.week === currentWeek);
  if (curIdx >= 0) backlogWeeks[curIdx] = snapshot;
  else backlogWeeks.push(snapshot);

  const meta: Meta = {
    generatedAt: now,
    lastSuccessfulIngest: now,
    totalBugs: published.length,
    totalFetched: bugs.length,
    excludedCount: normalized.length - active.length,
    excludedDetail,
    engineCount: engine.length,
    restrictedCount: active.filter((b) => b.restricted).length,
    webaimTotal: published.filter((b) => b.webaim).length,
    rawSeverityCounts,
    caveats: [
      "Bugs missing the `access` keyword are not counted.",
      usedKey
        ? "Security-restricted bugs are counted only in the overall total."
        : "Public bugs only (no API key set); restricted bugs are excluded.",
      "Severity is normalized to S1–S4 (legacy values mapped; see README for the raw breakdown).",
      "Time-to-close uses the latest resolution; ~7% of bugs are reopened.",
      "Graveyard products and the Thunderbird family (Thunderbird, SeaMonkey, MailNews Core, Calendar) are excluded; a11y-engine bugs are a flagged series.",
      "Months with a WebAIM contractor audit batch are marked with *.",
    ],
    bmoQueryBase: "https://bugzilla.mozilla.org/buglist.cgi?keywords=access",
  };

  await writeFile(join(DATA, "current.json"), JSON.stringify(snapshot, null, 2));
  await writeFile(join(DATA, "rollups.json"), JSON.stringify(rollups, null, 2));
  await writeFile(join(DATA, "aging.json"), JSON.stringify(aging, null, 2));
  await writeFile(join(DATA, "backlog.json"), JSON.stringify({ weeks: backlogWeeks }, null, 2));
  await writeFile(join(DATA, "meta.json"), JSON.stringify(meta, null, 2));

  console.log(
    `Ingested ${meta.totalBugs} active bugs ` +
      `(${meta.totalFetched} fetched, ${meta.excludedCount} excluded [${JSON.stringify(excludedDetail)}], ` +
      `${meta.engineCount} engine, ${meta.restrictedCount} restricted, ${meta.webaimTotal} WebAIM). ` +
      `Week ${currentWeek}.${toFreeze ? ` Froze ${toFreeze.week}.` : ""} ` +
      `Aging (6mo FIXED): median ${aging.overall.median.toFixed(0)}d, n=${aging.overall.n}.`,
  );
}

main().catch((e) => {
  console.error("\nIngest failed:", e);
  process.exit(1);
});
