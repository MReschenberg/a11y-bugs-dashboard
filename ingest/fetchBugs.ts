// Bugzilla REST client: paged, stable-sorted, de-duped, with a polite UA and
// retry/backoff. Sends the API key when present (restricted bugs, R6); without it,
// only public bugs are returned. Mirrors the query proven in ingest/audit.ts.

import type { RawBug } from "./schema";

const BMO = "https://bugzilla.mozilla.org/rest";
const UA = "a11y-bugs-dashboard/0.1 (mreschenberg@mozilla.com)";
const PAGE = 500;
const MAX_PAGES = 200; // safety cap; population is ~10k

const FIELDS = [
  "id", "creation_time", "cf_last_resolved", "last_change_time",
  "status", "resolution", "dupe_of", "severity", "keywords",
  "product", "component", "creator", "groups",
].join(",");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function bmoGet(params: Record<string, string>): Promise<any> {
  const url = new URL(`${BMO}/bug`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const key = process.env.BUGZILLA_API_KEY;
  if (key) url.searchParams.set("api_key", key);

  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (res.ok) return res.json();
    if (res.status === 429 || res.status >= 500) {
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    throw new Error(`BMO ${res.status} ${res.statusText}`);
  }
  throw new Error("BMO request failed after retries");
}

export interface FetchResult {
  bugs: RawBug[];
  totalMatches: number | null;
  usedKey: boolean;
}

export async function fetchAccessBugs(log: (m: string) => void = () => {}): Promise<FetchResult> {
  const byId = new Map<number, RawBug>();
  let totalMatches: number | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const json = await bmoGet({
      keywords: "access",
      keywords_type: "allwords",
      include_fields: FIELDS,
      order: "bug_id",
      limit: String(PAGE),
      offset: String(page * PAGE),
    });
    if (typeof json.total_matches === "number") totalMatches = json.total_matches;
    const bugs: RawBug[] = json.bugs ?? [];
    for (const b of bugs) byId.set(b.id, b);
    log(`fetched ${byId.size}…`);
    if (bugs.length < PAGE) break;
  }

  return {
    bugs: [...byId.values()].sort((a, b) => a.id - b.id),
    totalMatches,
    usedKey: !!process.env.BUGZILLA_API_KEY,
  };
}
