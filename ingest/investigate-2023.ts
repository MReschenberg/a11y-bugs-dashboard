/**
 * Deep-dive on the 2023 "fixed" rise (post-exclusion: no graveyard/Thunderbird/SeaMonkey).
 * Answers: is it real FIXED remediation, or mass duplicate/closure? old backlog vs fresh?
 * any of the WebAIM contractor's bugs involved? RUN: npx -y tsx ingest/investigate-2023.ts
 */
const BMO = "https://bugzilla.mozilla.org/rest";
const UA = "a11y-bugs-dashboard-audit/0.1 (mreschenberg@mozilla.com)";
const PAGE = 500, MAX_PAGES = 200;
const WEBAIM = "john.northup@usu.edu";
const FIELDS = ["id", "creation_time", "cf_last_resolved", "resolution", "product", "component", "creator"].join(",");

interface Bug {
  id: number; creation_time: string; cf_last_resolved?: string | null;
  resolution: string; product: string; component: string; creator?: string;
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
const yr = (iso?: string | null) => (iso ? iso.slice(0, 4) : null);
const day = (iso?: string | null) => (iso ? iso.slice(0, 10) : null);
const excluded = (b: Bug) => /graveyard/i.test(b.product) || b.product === "Thunderbird" || b.product === "SeaMonkey";
function tally<T>(items: T[], key: (t: T) => string | null | undefined) {
  const m = new Map<string, number>();
  for (const it of items) { const k = key(it); if (k) m.set(k, (m.get(k) ?? 0) + 1); }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}
const show = (rows: [string, number][], n = 12) => rows.slice(0, n).map(([k, v]) => `    ${String(v).padStart(4)}  ${k}`).join("\n");

async function main() {
  const active = (await fetchAll()).filter((b) => !excluded(b));
  const resolvedInYear = (y: string) => active.filter((b) => b.resolution && yr(b.cf_last_resolved) === y);

  console.log("\n=== Closed-by-resolution per year (post-exclusion) — is 'fixed' real, or dup/closure? ===");
  for (const y of ["2021", "2022", "2023", "2024", "2025"]) {
    const t = Object.fromEntries(tally(resolvedInYear(y), (b) => b.resolution));
    console.log(`  ${y}: ${JSON.stringify(t)}`);
  }

  const fixed23 = active.filter((b) => b.resolution === "FIXED" && yr(b.cf_last_resolved) === "2023");
  console.log(`\n=== 2023 FIXED = ${fixed23.length} ===`);
  console.log("By component:\n" + show(tally(fixed23, (b) => `${b.product} :: ${b.component}`)));
  console.log("By creation year (backlog cleanup vs fresh?):\n" + show(tally(fixed23, (b) => yr(b.creation_time)), 12));
  console.log("Top resolution days (mass-closure event?):\n" + show(tally(fixed23, (b) => day(b.cf_last_resolved)), 8));

  // WebAIM involvement in 2023 (any resolution)
  const johns2023 = resolvedInYear("2023").filter((b) => (b.creator ?? "").toLowerCase() === WEBAIM);
  const johnsEver = active.filter((b) => (b.creator ?? "").toLowerCase() === WEBAIM);
  const johnsByYearFiled = tally(johnsEver, (b) => yr(b.creation_time));
  console.log(`\n=== WebAIM contractor (${WEBAIM}) ===`);
  console.log(`  bugs of his RESOLVED in 2023 (any resolution): ${johns2023.length}`);
  console.log(`  his bugs FILED by year: ` + johnsByYearFiled.map(([k, v]) => `${k}:${v}`).join(", "));
}
main().catch((e) => { console.error("failed:", e); process.exit(1); });

export {};
