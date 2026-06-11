// FR-5 — About / README rendered in-page: data source, caveats, data dictionary,
// the normalized-severity map, how TTC is computed, calendar-year basis, last
// updated. Also exports the staleness banner shown in the header.
import {
  type DashboardData, SEVS, SEV_LABEL, NORM_TO_RAW, fmt, daysSince,
} from "../data";

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K, attrs: Record<string, string> = {}, text?: string,
): HTMLElementTagNameMap[K] => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text !== undefined) n.textContent = text;
  return n;
};

const STALE_DAYS = 8; // a missed weekly+ refresh

/** Returns a banner element, or null if the data is fresh. */
export function stalenessBanner(data: DashboardData): HTMLElement | null {
  const age = daysSince(data.meta.lastSuccessfulIngest);
  if (age <= STALE_DAYS) return null;
  return el("div", { class: "banner warn", role: "status" },
    `⚠ Data is ${Math.round(age)} days old (last successful ingest ${data.meta.lastSuccessfulIngest.slice(0, 10)}). The scheduled refresh may have failed.`);
}

function dictionary(): HTMLElement {
  const terms: Array<[string, string]> = [
    ["Created", "Bug creation date (when filed in Bugzilla — not necessarily when the access keyword was added)."],
    ["Fixed (latest resolution)", "Resolution = FIXED, dated by cf_last_resolved (the latest resolution; ~7% of bugs are reopened)."],
    ["Time to close", "Days from Created to latest FIXED resolution."],
    ["Open backlog age", "Days a still-open bug has been open, as of the last ingest."],
    ["Normalized severity", "Legacy Bugzilla severities mapped to S1–S4 (see map below); unset values shown as Unknown."],
    ["Won't-fix / duplicate / invalid", "Closed without a fix; reported separately, never counted as fixed."],
    ["A11y engine", "Bugs in Core :: Disability Access* (the accessibility engine itself), shown as a flagged series."],
  ];
  const dl = el("dl", { class: "dict" });
  for (const [t, d] of terms) {
    dl.append(el("dt", {}, t));
    dl.append(el("dd", {}, d));
  }
  return dl;
}

function severityMap(data: DashboardData): HTMLElement {
  const table = el("table", { class: "stats" });
  table.append(el("caption", {}, "Normalized severity mapping (major→S3 validated empirically)"));
  const head = el("tr");
  for (const h of ["Normalized", "Raw values folded in", "Bugs"]) head.append(el("th", { scope: "col" }, h));
  table.append(head);
  const counts = data.meta.rawSeverityCounts;
  for (const s of SEVS) {
    const raws = NORM_TO_RAW[s];
    const total = raws.reduce((acc, r) => acc + (counts[r] ?? 0), 0);
    const tr = el("tr");
    tr.append(el("th", { scope: "row" }, SEV_LABEL[s]));
    tr.append(el("td", {}, raws.join(", ")));
    tr.append(el("td", { class: "num" }, fmt.int(total)));
    table.append(tr);
  }
  return table;
}

export function aboutView(data: DashboardData): HTMLElement {
  const { meta } = data;
  const section = el("section", { "aria-labelledby": "fr5-h", class: "about" });
  section.append(el("h2", { id: "fr5-h" }, "About this dashboard"));

  const exParts = Object.entries(meta.excludedDetail)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${fmt.int(v)} ${k}`)
    .join(", ");
  section.append(el("p", {},
    "Everything here comes from the Bugzilla REST API — every bug carrying the access keyword. " +
    `${fmt.int(meta.totalBugs)} shown (${fmt.int(meta.totalFetched)} fetched; ` +
    `${fmt.int(meta.excludedCount)} excluded — ${exParts}; ` +
    `${fmt.int(meta.engineCount)} of those are the a11y engine itself). ` +
    `${fmt.int(meta.webaimTotal)} of the shown bugs were filed by a WebAIM contractor; ` +
    "months carrying one of their audit batches are marked * on the throughput chart."));

  section.append(el("h3", {}, "Caveats"));
  const ul = el("ul");
  for (const c of meta.caveats) ul.append(el("li", {}, c));
  section.append(ul);

  section.append(el("h3", {}, "Data dictionary"));
  section.append(dictionary());

  section.append(el("h3", {}, "Severity mapping"));
  section.append(severityMap(data));

  section.append(el("h3", {}, "Notes"));
  const notes = el("ul");
  notes.append(el("li", {}, "Calendar-year basis (= fiscal year). All dates bucketed in UTC."));
  notes.append(el("li", {}, "Provenance links are query-links only (no bug IDs) and approximate — they don't date-bound or exclude graveyards, and a normalized S-bucket expands to several raw severities."));
  notes.append(el("li", {}, "Population is a floor: bugs missing the access keyword are not counted."));
  section.append(notes);

  section.append(el("p", { class: "fine" },
    `Last updated ${meta.generatedAt.slice(0, 16).replace("T", " ")} UTC.`));

  return section;
}
