// FR-1 — Filed vs. fixed per month, filterable by normalized severity.
// Defaults to current + prior calendar year (deterministic, calendar-aligned).
import {
  type DashboardData, type ComponentSeries, type Sev, SEVS, SEV_LABEL, bmoLink, fmt,
  sinceMonth, sumSelected, WEBAIM_SPIKE_MIN,
} from "../data";
import {
  throughputFigure, type MonthPoint, type Overlay, type SeriesStyle, BASE_STYLE, OVERLAY_PALETTE,
} from "../charts/throughput";
import { buildTable, tableToggle } from "../a11y/dataTable";
import { frag } from "../dom";

const SVGNS = "http://www.w3.org/2000/svg";

interface LegendEntry { label: string; color: string; dash: string | null; }

/** Pattern-aware legend: each series shown by its actual color AND dash pattern + label
 * (so the legend doesn't depend on color alone). */
function legend(entries: LegendEntry[]): HTMLElement {
  const wrap = document.createElement("ul");
  wrap.className = "legend";
  for (const { label, color, dash } of entries) {
    const li = document.createElement("li");
    const svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("width", "34"); svg.setAttribute("height", "12"); svg.setAttribute("aria-hidden", "true");
    const line = document.createElementNS(SVGNS, "line");
    line.setAttribute("x1", "1"); line.setAttribute("y1", "6"); line.setAttribute("x2", "33"); line.setAttribute("y2", "6");
    line.setAttribute("stroke", color); line.setAttribute("stroke-width", "2.5");
    if (dash) line.setAttribute("stroke-dasharray", dash);
    svg.append(line);
    li.append(svg, document.createTextNode(` ${label}`));
    wrap.append(li);
  }
  return wrap;
}

interface State {
  sevs: Set<Sev>;
  allTime: boolean;
  shown: Set<string>; // broken-out component keys currently overlaid
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
    shown: new Set(),
  };

  // Each component keeps a fixed palette slot by its index, so its line/legend color stays
  // the same regardless of which boxes are checked.
  const styleFor = (key: string): SeriesStyle => {
    const i = data.rollups.components.findIndex((c) => c.key === key);
    return OVERLAY_PALETTE[i % OVERLAY_PALETTE.length];
  };

  const section = el("section", { "aria-labelledby": "fr1-h" });
  section.append(el("h2", { id: "fr1-h" }, "Filed vs. fixed over time"));
  const fr1Lede = el("p", { class: "lede" });
  fr1Lede.append(frag('This graph shows the number of `access`-bugs created ("Filed") and closed ("Fixed") over the selected time period.'));
  section.append(fr1Lede);

  // --- controls ---
  const controls = el("div", { class: "controls" });

  const fs = el("fieldset");
  const sevLegend = el("legend");
  sevLegend.append(el("a", { href: "#severity-mapping" }, "Normalized severity"));
  fs.append(sevLegend);
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
  const mkToggle = (labelText: string, key: "allTime"): HTMLLabelElement => {
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
  // One overlay toggle per broken-out Disability Access component.
  for (const c of data.rollups.components) {
    const id = `fr1-comp-${c.key}`;
    const label = el("label", { class: "check", for: id });
    const cb = el("input", { type: "checkbox", id });
    cb.addEventListener("change", () => {
      (cb as HTMLInputElement).checked ? state.shown.add(c.key) : state.shown.delete(c.key);
      render();
    });
    label.append(cb, document.createTextNode(` show ${c.label}`));
    opts.append(label);
  }
  controls.append(opts);

  section.append(controls);

  // --- hosts (re-rendered on change) ---
  const legendHost = el("div", { class: "legend-host" });
  const figureHost = el("div", { class: "figure-host" });
  const tableHost = el("div", { class: "table-host" });
  const provenance = el("p", { class: "provenance" });
  const webaimNote = el("p", { class: "fine" },
    `* Month includes a WebAIM contractor audit batch (≥${WEBAIM_SPIKE_MIN} bugs filed that month). ` +
    `A WebAIM contractor has filed ${fmt.int(data.meta.webaimTotal)} accessibility bugs in total.`);
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

  // Component overlays plot the whole component (all keywords), independent of the severity
  // filter — that filter governs only the main Filed/Fixed lines.
  function componentPoints(c: ComponentSeries): MonthPoint[] {
    const monthly = state.allTime ? c.monthly : sinceMonth(c.monthly, defaultFrom);
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
    const overlays: Overlay[] = data.rollups.components
      .filter((c) => state.shown.has(c.key))
      .map((c) => {
        const style = styleFor(c.key);
        return { label: `Fixed ${c.label}`, points: componentPoints(c), color: style.color, dash: style.dash };
      });

    legendHost.replaceChildren(legend([
      { label: "Filed", ...BASE_STYLE.Filed },
      { label: "Fixed", ...BASE_STYLE.Fixed },
      ...overlays.map((o) => ({ label: o.label, color: o.color, dash: o.dash })),
    ]));
    figureHost.replaceChildren(throughputFigure(pts, { overlays }));

    const headers = ["Month", "Filed", "Fixed", ...overlays.map((o) => o.label)];
    const overlayByMonth = overlays.map((o) => new Map(o.points.map((p) => [p.month, p.fixed])));
    const rows = pts.map((p) => [
      p.flagged ? `${p.month} * ${fmt.int(p.webaim ?? 0)}` : p.month, fmt.int(p.filed), fmt.int(p.fixed),
      ...overlayByMonth.map((m) => fmt.int(m.get(p.month) ?? 0)),
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
