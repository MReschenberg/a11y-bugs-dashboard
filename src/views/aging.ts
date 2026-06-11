// FR-2 — Aging report: time-to-close distribution (min/max/mean/median, median
// emphasized) for FIXED bugs resolved in the trailing 6 months, overall + per
// normalized severity, plus open-backlog age, a closed-outcome split, and a
// raw-severity breakdown that audits the normalization (R14).
import {
  type DashboardData, type Sev, SEVS, SEV_LABEL, NORM_TO_RAW, BUCKET_LABEL,
  bmoLink, fmt,
} from "../data";
import type { Stats, Bucket } from "../data";

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K, attrs: Record<string, string> = {}, text?: string,
): HTMLElementTagNameMap[K] => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text !== undefined) n.textContent = text;
  return n;
};

const RAW_TO_NORM: Record<string, Sev> = Object.fromEntries(
  SEVS.flatMap((s) => NORM_TO_RAW[s].map((raw) => [raw, s])),
) as Record<string, Sev>;

function statRow(label: string, s: Stats): HTMLTableRowElement {
  const tr = el("tr");
  const th = el("th", { scope: "row" }, label);
  tr.append(th);
  const cells: Array<[string, boolean]> = [
    [String(s.n), false],
    [s.n ? fmt.days(s.median) : "—", true], // median emphasized
    [s.n ? fmt.days(s.mean) : "—", false],
    [s.n ? fmt.days(s.min) : "—", false],
    [s.n ? fmt.days(s.max) : "—", false],
  ];
  for (const [val, emph] of cells) {
    const td = el("td", { class: emph ? "num emph" : "num" }, val);
    tr.append(td);
  }
  return tr;
}

function monthKeyAgo(fromISO: string, months: number): string {
  const d = new Date(fromISO);
  d.setUTCMonth(d.getUTCMonth() - months);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function agingView(data: DashboardData): HTMLElement {
  const { aging, rollups, meta } = data;
  const section = el("section", { "aria-labelledby": "fr2-h" });
  section.append(el("h2", { id: "fr2-h" }, "Aging — time to close"));
  section.append(
    el("p", { class: "lede" },
      `Days from a bug's creation to its latest FIXED resolution, for everything fixed in the last ${aging.windowMonths} months. ` +
      `Read the median, not the mean — the distribution is heavily right-skewed, and a handful of decade-old bugs drag the mean far above it.`),
  );

  // --- aging table ---
  const table = el("table", { class: "stats" });
  table.append(el("caption", {}, `Time-to-close, trailing ${aging.windowMonths} months (days)`));
  const thead = el("thead");
  const htr = el("tr");
  for (const h of ["Normalized severity", "n", "Median ★", "Mean", "Min", "Max"]) {
    const th = el("th", { scope: "col" }, h);
    htr.append(th);
  }
  thead.append(htr);
  table.append(thead);
  const tbody = el("tbody");
  tbody.append(statRow("Overall", aging.overall));
  for (const s of SEVS) tbody.append(statRow(SEV_LABEL[s], aging.bySeverity[s]));
  table.append(tbody);
  section.append(table);

  // --- open backlog callout ---
  const ob = aging.openBacklog;
  const yrs = (ob.max / 365).toFixed(1);
  section.append(
    el("p", { class: "callout" },
      `Open backlog: ${fmt.int(ob.n)} bugs still open, median age ${fmt.days(ob.median)}, oldest ${fmt.days(ob.max)} (~${yrs} years).`),
  );

  // --- closed-outcome split (trailing window, anchored to the data's asOf) ---
  const from = monthKeyAgo(aging.asOf, aging.windowMonths);
  const totals: Record<Bucket, number> = {
    fixed: 0, wontfix: 0, incomplete: 0, duplicate: 0, invalid: 0, other_closed: 0, open: 0,
  };
  for (const r of rollups.monthly) {
    if (r.period < from) continue;
    for (const b of Object.keys(totals) as Bucket[]) totals[b] += r.buckets[b];
  }
  const closedKeys: Bucket[] = ["fixed", "wontfix", "incomplete", "duplicate", "invalid", "other_closed"];
  const split = el("details", { class: "split" });
  split.append(el("summary", {}, `Closed-outcome split (last ${aging.windowMonths} months)`));
  const dl = el("dl", { class: "split-list" });
  for (const b of closedKeys) {
    dl.append(el("dt", {}, BUCKET_LABEL[b]));
    dl.append(el("dd", {}, fmt.int(totals[b])));
  }
  split.append(dl);
  split.append(el("p", { class: "fine" }, "Won't-fix / duplicate / invalid are shown separately — never counted as fixed."));
  section.append(split);

  // --- raw-severity breakdown (audits the normalization, R14) ---
  const raw = el("details", { class: "split" });
  raw.append(el("summary", {}, "Raw severity → normalized (audit the S-mapping)"));
  const rt = el("table", { class: "stats" });
  rt.append(el("caption", {}, "Raw Bugzilla severity values folded into each normalized bucket"));
  const rthead = el("tr");
  for (const h of ["Raw value", "Bugs", "→ Normalized"]) rthead.append(el("th", { scope: "col" }, h));
  rt.append(rthead);
  const entries = Object.entries(meta.rawSeverityCounts).sort((a, b) => b[1] - a[1]);
  for (const [val, count] of entries) {
    const tr = el("tr");
    tr.append(el("th", { scope: "row" }, val));
    tr.append(el("td", { class: "num" }, fmt.int(count)));
    tr.append(el("td", {}, SEV_LABEL[RAW_TO_NORM[val] ?? "unknown"]));
    rt.append(tr);
  }
  raw.append(rt);
  section.append(raw);

  // --- provenance ---
  const p = el("p", { class: "provenance" });
  const a = el("a", { href: bmoLink({ resolutions: ["FIXED"] }), target: "_blank", rel: "noopener" }, "fixed access bugs ↗");
  p.append(document.createTextNode("Backing bugs: "), a, document.createTextNode(" (approximate — no date bound)"));
  section.append(p);

  return section;
}
