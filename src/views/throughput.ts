// FR-1 — Filed vs. fixed per month, filterable by normalized severity.
// Defaults to current + prior calendar year (deterministic, calendar-aligned).
import {
  type DashboardData, type Sev, SEVS, SEV_LABEL, bmoLink, fmt,
  sinceMonth, sumSelected, WEBAIM_SPIKE_MIN,
} from "../data";
import { throughputFigure, type MonthPoint, type SeriesName, SERIES_STYLE } from "../charts/throughput";
import { buildTable, tableToggle } from "../a11y/dataTable";

const SVGNS = "http://www.w3.org/2000/svg";

/** Pattern-aware legend: each series shown by its actual color AND dash pattern + label
 * (so the legend doesn't depend on color alone). */
function legend(series: SeriesName[]): HTMLElement {
  const wrap = document.createElement("ul");
  wrap.className = "legend";
  for (const s of series) {
    const { color, dash } = SERIES_STYLE[s];
    const li = document.createElement("li");
    const svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("width", "34"); svg.setAttribute("height", "12"); svg.setAttribute("aria-hidden", "true");
    const line = document.createElementNS(SVGNS, "line");
    line.setAttribute("x1", "1"); line.setAttribute("y1", "6"); line.setAttribute("x2", "33"); line.setAttribute("y2", "6");
    line.setAttribute("stroke", color); line.setAttribute("stroke-width", "2.5");
    if (dash) line.setAttribute("stroke-dasharray", dash);
    svg.append(line);
    li.append(svg, document.createTextNode(` ${s}`));
    wrap.append(li);
  }
  return wrap;
}

interface State {
  sevs: Set<Sev>;
  allTime: boolean;
  showEngine: boolean;
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
};

export function throughputView(data: DashboardData): HTMLElement {
  // Derive the window from the data's build time, not the viewer's clock, so a stale
  // build shows a deterministic window.
  const currentYear = new Date(data.meta.generatedAt).getUTCFullYear();
  const defaultFrom = `${currentYear - 1}-01`;

  const state: State = {
    sevs: new Set(SEVS.filter((s) => data.rollups.monthly.some((r) => r.bySeverity[s].filed > 0))),
    allTime: false,
    showEngine: false,
  };

  const section = el("section", { "aria-labelledby": "fr1-h" });
  section.append(el("h2", { id: "fr1-h" }, "Filed vs. fixed over time"));
  section.append(
    el("p", { class: "lede" },
      "Accessibility bugs opened vs. resolved-fixed each month. Filter by normalized severity (S1–S4; see About for the raw mapping). Graveyard and Thunderbird-family products are excluded."),
  );

  // --- controls ---
  const controls = el("div", { class: "controls" });

  const fs = el("fieldset");
  fs.append(el("legend", {}, "Normalized severity"));
  for (const s of SEVS) {
    const id = `fr1-sev-${s}`;
    const label = el("label", { class: "check", for: id });
    const cb = el("input", { type: "checkbox", id });
    (cb as HTMLInputElement).checked = state.sevs.has(s);
    cb.addEventListener("change", () => {
      (cb as HTMLInputElement).checked ? state.sevs.add(s) : state.sevs.delete(s);
      render();
    });
    label.append(cb, document.createTextNode(` ${SEV_LABEL[s]}`));
    fs.append(label);
  }
  controls.append(fs);

  const opts = el("fieldset");
  opts.append(el("legend", {}, "View"));
  const mkToggle = (labelText: string, key: "allTime" | "showEngine"): HTMLLabelElement => {
    const id = `fr1-${key}`;
    const label = el("label", { class: "check", for: id });
    const cb = el("input", { type: "checkbox", id });
    cb.addEventListener("change", () => {
      state[key] = (cb as HTMLInputElement).checked;
      render();
    });
    label.append(cb, document.createTextNode(` ${labelText}`));
    return label;
  };
  opts.append(mkToggle("All years (default: this + last year)", "allTime"));
  opts.append(mkToggle("Overlay a11y-engine fixed", "showEngine"));
  controls.append(opts);

  section.append(controls);

  // --- hosts (re-rendered on change) ---
  const legendHost = el("div", { class: "legend-host" });
  const figureHost = el("div", { class: "figure-host" });
  const tableHost = el("div", { class: "table-host" });
  const provenance = el("p", { class: "provenance" });
  const webaimNote = el("p", { class: "fine" },
    `* Month includes a WebAIM contractor audit batch (≥${WEBAIM_SPIKE_MIN} bugs filed that month) — a single audit, ` +
    `not organic intake. A WebAIM contractor has filed ${fmt.int(data.meta.webaimTotal)} accessibility bugs in total.`);
  section.append(legendHost, figureHost, tableHost, provenance, webaimNote);

  function points(): MonthPoint[] {
    const sevs = [...state.sevs];
    const monthly = state.allTime
      ? data.rollups.monthly
      : sinceMonth(data.rollups.monthly, defaultFrom);
    return monthly.map((r) => ({
      month: r.period,
      filed: sumSelected(r, "filed", sevs),
      fixed: sumSelected(r, "fixed", sevs),
      flagged: r.webaimFiled >= WEBAIM_SPIKE_MIN,
      webaim: r.webaimFiled,
    }));
  }

  function enginePoints(): MonthPoint[] {
    const monthly = state.allTime
      ? data.rollups.engineMonthly
      : sinceMonth(data.rollups.engineMonthly, defaultFrom);
    return monthly.map((r) => ({ month: r.period, filed: r.filed, fixed: r.fixed }));
  }

  function render(): void {
    if (state.sevs.size === 0) {
      legendHost.replaceChildren();
      figureHost.replaceChildren(
        el("p", { class: "callout", role: "status" }, "Select at least one severity to see the chart."));
      tableHost.replaceChildren();
      provenance.replaceChildren();
      return;
    }
    const pts = points();
    const engine = state.showEngine ? enginePoints() : undefined;

    const series: SeriesName[] = ["Filed", "Fixed", ...(engine ? ["Engine fixed" as const] : [])];
    legendHost.replaceChildren(legend(series));
    figureHost.replaceChildren(throughputFigure(pts, { engine }));

    const headers = ["Month", "Filed", "Fixed", ...(engine ? ["Engine fixed"] : [])];
    const engineByMonth = new Map((engine ?? []).map((p) => [p.month, p.fixed]));
    const rows = pts.map((p) => [
      p.flagged ? `${p.month} * ${fmt.int(p.webaim ?? 0)}` : p.month, fmt.int(p.filed), fmt.int(p.fixed),
      ...(engine ? [fmt.int(engineByMonth.get(p.month) ?? 0)] : []),
    ]);
    const table = buildTable("Filed vs. fixed per month (* N = WebAIM audit batch of N bugs)", headers, rows);
    tableHost.replaceChildren(tableToggle(table, "data table"), table);

    const sevs = [...state.sevs];
    provenance.replaceChildren(
      document.createTextNode("Backing bugs in Bugzilla: "),
      Object.assign(el("a", { href: bmoLink({ severities: sevs }), target: "_blank", rel: "noopener" }),
        { textContent: "all matching ↗" }),
      document.createTextNode(" · "),
      Object.assign(el("a", { href: bmoLink({ resolutions: ["FIXED"], severities: sevs }), target: "_blank", rel: "noopener" }),
        { textContent: "fixed only ↗" }),
      document.createTextNode(" (approximate — no date bound; see About)"),
    );
  }

  render();
  return section;
}
