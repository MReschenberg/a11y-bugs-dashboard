// FR-2 (over time) / FR-8 — Open backlog trend: how many a11y bugs are open and how
// old they are, week by week. Counts and ages are exact (from timestamps); pre-launch
// weeks are reconstructed, so their severity split is approximate (noted).
import { type DashboardData, isoWeekToDate, fmt } from "../data";
import { backlogFigure, type TrendPoint } from "../charts/backlog";
import { buildTable, tableToggle } from "../a11y/dataTable";

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K, attrs: Record<string, string> = {}, text?: string,
): HTMLElementTagNameMap[K] => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text !== undefined) n.textContent = text;
  return n;
};

export function backlogView(data: DashboardData): HTMLElement {
  const weeks = data.backlog.weeks;
  const section = el("section", { "aria-labelledby": "fr2t-h" });
  section.append(el("h2", { id: "fr2t-h" }, "Open backlog over time"));
  section.append(
    el("p", { class: "lede" },
      "Accessibility bugs still open, and their median age, by week. Counts and ages are exact; " +
      "weeks before this dashboard launched are reconstructed from bug timestamps, so their severity split is approximate."),
  );

  if (weeks.length === 0) {
    section.append(el("p", { class: "callout" }, "No backlog history yet."));
    return section;
  }

  // First authoritative (frozen) week, if any — everything before it is reconstructed.
  const firstFrozen = weeks.find((w) => w.source === "snapshot");
  const backfillUntil = firstFrozen ? isoWeekToDate(firstFrozen.week) : null;

  const countPts: TrendPoint[] = weeks.map((w) => ({ date: isoWeekToDate(w.week), value: w.openCount, week: w.week }));
  const agePts: TrendPoint[] = weeks.map((w) => ({ date: isoWeekToDate(w.week), value: Math.round(w.openBacklog.median), week: w.week }));

  const countHost = el("div", { class: "figure-host" });
  countHost.append(el("h3", {}, "Open bug count"));
  countHost.append(backlogFigure(countPts, { label: "open bugs", color: "#1f6feb", backfillUntil }));

  const ageHost = el("div", { class: "figure-host" });
  ageHost.append(el("h3", {}, "Median age of open bugs (days)"));
  ageHost.append(backlogFigure(agePts, { label: "median age (days)", color: "#9a6700", backfillUntil }));

  section.append(countHost, ageHost);

  // One shared data-table mirror for both charts.
  const rows = weeks.map((w) => [
    w.week, fmt.int(w.openCount), fmt.days(w.openBacklog.median), fmt.days(w.openBacklog.max),
    w.source === "snapshot" ? "frozen" : "reconstructed",
  ]);
  const table = buildTable("Open backlog by week", ["Week", "Open", "Median age", "Max age", "Source"], rows);
  section.append(tableToggle(table, "backlog data table"), table);

  return section;
}
