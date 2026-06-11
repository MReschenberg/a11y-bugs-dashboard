// FR-1 throughput chart: filed vs. fixed per month, built with Observable Plot.
// Pure builder — takes filtered points, returns a fresh DOM node (Plot has no
// in-place update, so the view swaps the node on filter change).
import * as Plot from "@observablehq/plot";

export type SeriesName = "Filed" | "Fixed" | "Engine fixed";

// Each series has a distinct COLOR *and* a distinct line pattern, so the chart is
// readable without relying on color alone (colorblind-friendly). The view renders a
// legend from this same map so the legend conveys the pattern too.
export const SERIES_STYLE: Record<SeriesName, { color: string; dash: string | null }> = {
  Filed: { color: "#1f6feb", dash: null },        // solid
  Fixed: { color: "#2da44e", dash: "7 4" },        // dashed
  "Engine fixed": { color: "#9a6700", dash: "2 3" }, // dotted
};

export interface MonthPoint {
  month: string; // "YYYY-MM"
  filed: number;
  fixed: number;
  flagged?: boolean; // month contains a WebAIM contractor batch (annotated with *)
  webaim?: number;   // count of WebAIM-contractor filings that month (shown next to *)
}

interface Row {
  date: Date;
  count: number;
  series: SeriesName;
}

const toDate = (month: string): Date => new Date(`${month}-01T00:00:00Z`);
const ym = (d: Date): string =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

export function throughputFigure(
  points: MonthPoint[],
  opts: { engine?: MonthPoint[] } = {},
): HTMLElement | SVGSVGElement {
  const rows: Row[] = points.flatMap((p) => [
    { date: toDate(p.month), count: p.filed, series: "Filed" },
    { date: toDate(p.month), count: p.fixed, series: "Fixed" },
  ]);
  const engineRows: Row[] = (opts.engine ?? []).map((p) => ({
    date: toDate(p.month), count: p.fixed, series: "Engine fixed",
  }));
  const all = [...rows, ...engineRows];
  const flagged = points
    .filter((p) => p.flagged)
    .map((p) => ({ date: toDate(p.month), count: p.filed, n: p.webaim ?? 0 }));

  const present: SeriesName[] = ["Filed", "Fixed", ...(engineRows.length ? ["Engine fixed" as const] : [])];
  // One mark per series so each gets its own dash pattern (Plot's strokeDasharray
  // must be a constant per mark, not a per-point channel).
  const lineMark = (s: SeriesName) =>
    Plot.lineY(all.filter((r) => r.series === s), {
      x: "date", y: "count", stroke: "series", strokeWidth: 2, curve: "monotone-x",
      strokeDasharray: SERIES_STYLE[s].dash ?? undefined,
      ariaLabel: (d: Row) => `${d.series}: ${d.count} in ${ym(d.date)}`,
    });

  return Plot.plot({
    width: 880,
    height: 360,
    marginLeft: 54,
    marginBottom: 36,
    style: { fontSize: "13px", background: "transparent" },
    x: { type: "utc", label: null, grid: false },
    y: { label: "bugs / month", grid: true, nice: true, zero: true },
    color: {
      legend: false, // we render our own pattern-aware legend in the view
      domain: Object.keys(SERIES_STYLE),
      range: Object.values(SERIES_STYLE).map((s) => s.color),
    },
    marks: [
      Plot.ruleY([0]),
      ...present.map(lineMark),
      // WebAIM audit-batch markers (*) above the Filed value for flagged months.
      ...(flagged.length
        ? [Plot.text(flagged, {
            x: "date", y: "count", text: (d: { n: number }) => `* ${d.n}`, dy: -10,
            fontSize: 13, fontWeight: "bold", fill: "currentColor",
            ariaLabel: (d: { n: number }) => `WebAIM contractor audit batch: ${d.n} bugs filed`,
          })]
        : []),
      // Tooltip: the stroke channel already shows the series with a color swatch — no
      // duplicate plain-text series line, no redundant count.
      Plot.tip(all, Plot.pointerX({ x: "date", y: "count", stroke: "series" })),
    ],
    ariaLabel: "Accessibility bugs filed versus fixed per month",
  });
}
