/**
 * One-off investigation of two anomalies the dashboard surfaced:
 *   1. The Dec 2025 "filed" spike (171 vs ~30–60/mo).
 *   2. The 2023 inflection (filed + fixed both ~doubled).
 * Breaks the slices down by component, reporter (creator), day, and severity to
 * find a bulk source / mass event. Read-only; uses the API key if present.
 *
 * RUN: npx -y tsx ingest/investigate.ts
 */
const BMO = "https://bugzilla.mozilla.org/rest";
const UA = "a11y-bugs-dashboard-audit/0.1 (mreschenberg@mozilla.com)";
const PAGE = 500, MAX_PAGES = 200;
const FIELDS = [
  "id", "creation_time", "cf_last_resolved", "resolution",
  "product", "component", "creator", "severity", "keywords", "summary",
].join(",");

interface Bug {
  id: number; creation_time: string; cf_last_resolved?: string | null;
  resolution: string; product: string; component: string;
  creator?: string; severity?: string; keywords?: string[]; summary?: string;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function bmoGet(params: Record<string, string>): Promise<any> {
  const url = new URL(`${BMO}/bug`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  try { (process as any).loadEnvFile?.(".env"); } catch { /* */ }
  if (process.env.BUGZILLA_API_KEY) url.searchParams.set("api_key", process.env.BUGZILLA_API_KEY);
  for (let a = 0; a < 5; a++) {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (res.ok) return res.json();
    if (res.status === 429 || res.status >= 500) { await sleep(1000 * 2 ** a); continue; }
    throw new Error(`BMO ${res.status}`);
  }
  throw new Error("failed");
}

async function fetchAll(): Promise<Bug[]> {
  const byId = new Map<number, Bug>();
  for (let p = 0; p < MAX_PAGES; p++) {
    const j = await bmoGet({ keywords: "access", keywords_type: "allwords", include_fields: FIELDS, order: "bug_id", limit: String(PAGE), offset: String(p * PAGE) });
    const bugs: Bug[] = j.bugs ?? [];
    for (const b of bugs) byId.set(b.id, b);
    process.stderr.write(`  fetched ${byId.size}…\r`);
    if (bugs.length < PAGE) break;
  }
  process.stderr.write("\n");
  return [...byId.values()];
}

const ym = (iso?: string | null) => (iso ? iso.slice(0, 7) : null);
const yr = (iso?: string | null) => (iso ? iso.slice(0, 4) : null);
const day = (iso?: string | null) => (iso ? iso.slice(0, 10) : null);

function tally<T>(items: T[], key: (t: T) => string | null | undefined): [string, number][] {
  const m = new Map<string, number>();
  for (const it of items) { const k = key(it); if (k) m.set(k, (m.get(k) ?? 0) + 1); }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}
const topN = (rows: [string, number][], n = 12) =>
  rows.slice(0, n).map(([k, v]) => `    ${String(v).padStart(4)}  ${k}`).join("\n");

async function main() {
  const bugs = await fetchAll();
  const graveyard = (b: Bug) => /graveyard/i.test(b.product);
  const active = bugs.filter((b) => !graveyard(b));

  // ---- 1. Dec 2025 filed spike ----
  const dec = active.filter((b) => ym(b.creation_time) === "2025-12");
  console.log(`\n========== Dec 2025 FILED spike: ${dec.length} access bugs created ==========`);
  console.log("By component:\n" + topN(tally(dec, (b) => `${b.product} :: ${b.component}`)));
  console.log("By reporter (creator):\n" + topN(tally(dec, (b) => b.creator)));
  console.log("By creation day (clustered?):\n" + topN(tally(dec, (b) => day(b.creation_time)), 10));
  console.log("By severity:\n" + topN(tally(dec, (b) => b.severity)));
  console.log("Sample summaries (first 8):");
  for (const b of dec.slice(0, 8)) console.log(`    [${b.severity}] ${b.product}::${b.component} — ${(b.summary ?? "").slice(0, 90)}`);

  // ---- 2. 2023 inflection ----
  const created = (y: string) => active.filter((b) => yr(b.creation_time) === y);
  const fixedIn = (y: string) => active.filter((b) => b.resolution === "FIXED" && yr(b.cf_last_resolved) === y);
  console.log(`\n========== 2023 inflection ==========`);
  for (const y of ["2022", "2023", "2024"]) {
    console.log(`  ${y}: created=${created(y).length}, fixed=${fixedIn(y).length}`);
  }
  console.log("\n2023 CREATED — by component:\n" + topN(tally(created("2023"), (b) => `${b.product} :: ${b.component}`)));
  console.log("2023 CREATED — by reporter:\n" + topN(tally(created("2023"), (b) => b.creator)));
  console.log("2023 FIXED — by component:\n" + topN(tally(fixedIn("2023"), (b) => `${b.product} :: ${b.component}`)));
  console.log("2023 FIXED — by who closed? (n/a — creator≠closer); by component above.");

  // What's NEW in 2023 vs 2022: reporters that appear a lot in 2023 but not 2022.
  const r22 = new Map(tally(created("2022"), (b) => b.creator));
  const r23 = tally(created("2023"), (b) => b.creator);
  const newish = r23.filter(([k, v]) => v >= 10 && (r22.get(k) ?? 0) < v / 2).slice(0, 10);
  console.log("\n2023 reporters surging vs 2022 (≥10 in 2023, <half that in 2022):\n" +
    newish.map(([k, v]) => `    ${String(v).padStart(4)}  ${k}  (2022: ${r22.get(k) ?? 0})`).join("\n"));
}
main().catch((e) => { console.error("failed:", e); process.exit(1); });

export {};
