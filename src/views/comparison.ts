// FR-3 — Year-over-year and month-over-month, numeric (no graphs, per the PRD),
// with prior-period deltas. Calendar-year basis.
import { type DashboardData, type EventRollup, fmt } from "../data";

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K, attrs: Record<string, string> = {}, text?: string,
): HTMLElementTagNameMap[K] => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text !== undefined) n.textContent = text;
  return n;
};

function deltaCell(curr: number, prev: number | null): HTMLTableCellElement {
  if (prev === null) return el("td", { class: "num delta" }, "—");
  const d = curr - prev;
  const cls = d > 0 ? "num delta up" : d < 0 ? "num delta down" : "num delta";
  return el("td", { class: cls }, d === 0 ? "0" : fmt.delta(d));
}

function comparisonTable(caption: string, rows: EventRollup[], periodLabel: string): HTMLTableElement {
  const table = el("table", { class: "stats" });
  table.append(el("caption", {}, caption));
  const thead = el("tr");
  for (const h of [periodLabel, "Filed", "Δ filed", "Fixed", "Δ fixed"]) {
    thead.append(el("th", { scope: "col" }, h));
  }
  table.append(thead);
  const tbody = el("tbody");
  rows.forEach((r, i) => {
    const prev = i > 0 ? rows[i - 1] : null;
    const tr = el("tr");
    tr.append(el("th", { scope: "row" }, r.period));
    tr.append(el("td", { class: "num" }, fmt.int(r.filed)));
    tr.append(deltaCell(r.filed, prev ? prev.filed : null));
    tr.append(el("td", { class: "num" }, fmt.int(r.fixed)));
    tr.append(deltaCell(r.fixed, prev ? prev.fixed : null));
    tbody.append(tr);
  });
  table.append(tbody);
  return table;
}

export function comparisonView(data: DashboardData): HTMLElement {
  const section = el("section", { "aria-labelledby": "fr3-h" });
  section.append(el("h2", { id: "fr3-h" }, "Year-over-year & month-over-month"));
  section.append(
    el("p", { class: "lede" },
      "Filed and fixed per period, with deltas against the one before. Calendar-year basis. " +
      "These aren't apples-to-apples across years — we shipped on-train then and off-train now — so read the trend, not the exact numbers."),
  );

  const yearly = data.rollups.yearly.slice(-8);
  const monthly = data.rollups.monthly.slice(-13);

  const grid = el("div", { class: "two-col" });
  grid.append(comparisonTable("By calendar year", yearly, "Year"));
  grid.append(comparisonTable("By month (last 13)", monthly, "Month"));
  section.append(grid);

  return section;
}
