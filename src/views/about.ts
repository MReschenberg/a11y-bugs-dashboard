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

// Render a string with minimal inline markdown: `code` → <code>, _em_ → <em>.
function frag(text: string): DocumentFragment {
  const f = document.createDocumentFragment();
  const re = /`([^`]+)`|_([^_]+)_/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) f.append(text.slice(last, m.index));
    f.append(m[1] !== undefined ? el("code", {}, m[1]) : el("em", {}, m[2]));
    last = re.lastIndex;
  }
  if (last < text.length) f.append(text.slice(last));
  return f;
}

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
    ["Fixed (latest resolution)", "Resolution = FIXED. We track the most-recent timestamp on this field. For reopened bugs (7% of ingested data), this is the _latest_ closure, not the first."],
    ["Time to close", "Days from Created to latest FIXED resolution."],
    ["Open backlog age", "Days a still-open bug has been open, as of the last ingest."],
    ["Normalized severity", "Legacy Bugzilla severities mapped to S1–S4 (see map below); unset values shown as Unknown."],
    ["Won't-fix / duplicate / invalid", "Closed without a fix; reported separately, never counted as fixed."],
    ["A11y engine", "Bugs in Core :: Disability Access* (the accessibility engine itself), shown as a flagged series."],
  ];
  const dl = el("dl", { class: "dict" });
  for (const [t, d] of terms) {
    dl.append(el("dt", {}, t));
    const dd = el("dd");
    dd.append(frag(d));
    dl.append(dd);
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
  const intro = el("p");
  intro.append(frag(
    "This dashboard uses the Bugzilla REST API to track all bugs with the `access` keyword. " +
    `It currently tracks ${fmt.int(meta.totalBugs)} bugs. ` +
    `The original fetch pulled ${fmt.int(meta.totalFetched)} bugs, but ${fmt.int(meta.excludedCount)} were excluded — ${exParts}. ` +
    `${fmt.int(meta.engineCount)} bugs were in the a11y engine component and are represented in their own series.`));
  section.append(intro);

  section.append(el("h3", {}, "Caveats"));
  const ul = el("ul");
  for (const c of meta.caveats) {
    const li = el("li");
    li.append(frag(c));
    ul.append(li);
  }
  section.append(ul);

  section.append(el("h3", {}, "Data dictionary"));
  section.append(dictionary());

  section.append(el("h3", { id: "severity-mapping" }, "Severity mapping"));
  section.append(el("p", {},
    "We've used several different severity-mapping systems in Bugzilla over the years. " +
    "This table explains how those systems have been merged to bring you the data in the graph above."));
  section.append(severityMap(data));

  section.append(el("p", { class: "fine" },
    `Last updated ${meta.generatedAt.slice(0, 16).replace("T", " ")} UTC.`));

  return section;
}
