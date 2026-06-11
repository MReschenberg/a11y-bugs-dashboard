// FR-1 throughput chart: filed vs. fixed per month, built with Observable Plot.
// Pure builder — takes filtered points, returns a fresh DOM node (Plot has no
// in-place update, so the view swaps the node on filter change).
import * as Plot from "@observablehq/plot";

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
  series: "Filed" | "Fixed" | "Engine fixed";
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
    date: toDate(p.month),
    count: p.fixed,
    series: "Engine fixed",
  }));
  const all = [...rows, ...engineRows];
  const flagged = points
    .filter((p) => p.flagged)
    .map((p) => ({ date: toDate(p.month), count: p.filed, n: p.webaim ?? 0 }));

  return Plot.plot({
    width: 880,
    height: 360,
    marginLeft: 54,
    marginBottom: 36,
    style: { fontSize: "13px", background: "transparent" },
    x: { type: "utc", label: null, grid: false },
    y: { label: "bugs / month", grid: true, nice: true, zero: true },
    color: {
      legend: true,
      domain: ["Filed", "Fixed", "Engine fixed"],
      range: ["#1f6feb", "#2da44e", "#9a6700"],
    },
    marks: [
      Plot.ruleY([0]),
      // Filed / Fixed: solid.
      Plot.lineY(rows, {
        x: "date", y: "count", stroke: "series", strokeWidth: 2, curve: "monotone-x",
        ariaLabel: (d: Row) => `${d.series}: ${d.count} in ${ym(d.date)}`,
      }),
      // Engine series: dashed, so it's distinguishable without relying on color alone (a11y).
      ...(engineRows.length
        ? [Plot.lineY(engineRows, {
            x: "date", y: "count", stroke: "series", strokeWidth: 2, curve: "monotone-x",
            strokeDasharray: "4 3",
            ariaLabel: (d: Row) => `${d.series}: ${d.count} in ${ym(d.date)}`,
          })]
        : []),
      // WebAIM audit-batch markers (*) above the Filed value for flagged months.
      ...(flagged.length
        ? [Plot.text(flagged, {
            x: "date", y: "count", text: (d: { n: number }) => `* ${d.n}`, dy: -10,
            fontSize: 13, fontWeight: "bold", fill: "currentColor",
            ariaLabel: (d: { n: number }) => `WebAIM contractor audit batch: ${d.n} bugs filed`,
          })]
        : []),
      Plot.tip(all, Plot.pointerX({
        x: "date", y: "count", stroke: "series",
        channels: { Series: "series", Count: "count" },
      })),
    ],
    ariaLabel: "Accessibility bugs filed versus fixed per month",
  });
}
