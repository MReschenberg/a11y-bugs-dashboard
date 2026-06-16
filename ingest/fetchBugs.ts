// Bugzilla REST client: paged, stable-sorted, de-duped, with a polite UA and
// retry/backoff. Sends the API key when present (restricted bugs, R6); without it,
// only public bugs are returned. Mirrors the query proven in ingest/audit.ts.

import type { RawBug } from "./schema";

const BMO = "https://bugzilla.mozilla.org/rest";
const UA = "a11y-bugs-dashboard/0.1 (mreschenberg@mozilla.com)";
const PAGE = 500;
const MAX_PAGES = 200; // safety cap; population is ~10k
// Anonymous BMO throttles rapid sequential requests (truncated/duplicate pages, which the
// validator then rejects as an incomplete fetch). Authenticated CI isn't limited this way,
// so we only pace pages when there's no API key — enough to let public-only runs complete.
const ANON_PAGE_DELAY_MS = 400;

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

// Page a search to exhaustion: de-dupe by id, sort by id, and stop when a page comes back
// short (the only reliable signal — the BMO search endpoint doesn't always return
// total_matches). `query` carries the search predicate (keyword, or product+component).
async function fetchPaged(
  query: Record<string, string>,
  log: (m: string) => void,
): Promise<FetchResult> {
  const byId = new Map<number, RawBug>();
  let totalMatches: number | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    if (page > 0 && !process.env.BUGZILLA_API_KEY) await sleep(ANON_PAGE_DELAY_MS);
    const json = await bmoGet({
      ...query,
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

/** All bugs carrying the `access` keyword — the main dashboard population. */
export function fetchAccessBugs(log: (m: string) => void = () => {}): Promise<FetchResult> {
  return fetchPaged({ keywords: "access", keywords_type: "allwords" }, log);
}

/** Every bug in one product/component, regardless of keyword (used for the broken-out
 *  Disability Access series). `total_matches` is absent here, so completeness rests on the
 *  short-page break in `fetchPaged`. */
export function fetchComponentBugs(
  product: string,
  component: string,
  log: (m: string) => void = () => {},
): Promise<FetchResult> {
  return fetchPaged({ product, component }, log);
}
