// FR-1 throughput chart: filed vs. fixed per month, built with Observable Plot.
// Pure builder — takes filtered points, returns a fresh DOM node (Plot has no
// in-place update, so the view swaps the node on filter change).
import * as Plot from "@observablehq/plot";

export interface SeriesStyle {
  color: string;
  dash: string | null;
}

// The two base series have a distinct COLOR *and* a distinct line pattern, so the chart is
// readable without relying on color alone (colorblind-friendly). The view renders a legend
// from these same styles so the legend conveys the pattern too.
export const BASE_STYLE: Record<"Filed" | "Fixed", SeriesStyle> = {
  Filed: { color: "#1f6feb", dash: null },   // solid
  Fixed: { color: "#2da44e", dash: "7 4" },  // dashed
};

// Styles for broken-out component overlays, assigned by the component's index so a given
// component always draws in the same color/pattern regardless of which boxes are checked.
export const OVERLAY_PALETTE: SeriesStyle[] = [
  { color: "#9a6700", dash: "2 3" }, // amber, dotted (formerly the a11y-engine overlay)
  { color: "#8250df", dash: "6 3" }, // purple, long-dash
];

export interface MonthPoint {
  month: string; // "YYYY-MM"
  filed: number;
  fixed: number;
  flagged?: boolean; // month contains a WebAIM contractor batch (annotated with *)
  webaim?: number;   // count of WebAIM-contractor filings that month (shown next to *)
}

/** A broken-out component drawn as an extra fixed-count line over the main chart. */
export interface Overlay {
  label: string;       // series name (also the legend/table label)
  points: MonthPoint[];
  color: string;
  dash: string | null;
}

interface Row {
  date: Date;
  count: number;
  series: string;
}

const toDate = (month: string): Date => new Date(`${month}-01T00:00:00Z`);
const ym = (d: Date): string =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

export function throughputFigure(
  points: MonthPoint[],
  opts: { overlays?: Overlay[] } = {},
): HTMLElement | SVGSVGElement {
  const overlays = opts.overlays ?? [];
  const rows: Row[] = points.flatMap((p) => [
    { date: toDate(p.month), count: p.filed, series: "Filed" },
    { date: toDate(p.month), count: p.fixed, series: "Fixed" },
  ]);
  // Each overlay contributes one line of its FIXED count.
  const overlayRows: Row[] = overlays.flatMap((o) =>
    o.points.map((p) => ({ date: toDate(p.month), count: p.fixed, series: o.label })),
  );
  const all = [...rows, ...overlayRows];
  const flagged = points
    .filter((p) => p.flagged)
    .map((p) => ({ date: toDate(p.month), count: p.filed, n: p.webaim ?? 0 }));

  // Series in draw order, paired with their style (base first, then overlays).
  const styled: { series: string; style: SeriesStyle }[] = [
    { series: "Filed", style: BASE_STYLE.Filed },
    { series: "Fixed", style: BASE_STYLE.Fixed },
    ...overlays.map((o) => ({ series: o.label, style: { color: o.color, dash: o.dash } })),
  ];
  // One mark per series so each gets its own dash pattern (Plot's strokeDasharray
  // must be a constant per mark, not a per-point channel).
  const lineMark = ({ series, style }: { series: string; style: SeriesStyle }) =>
    Plot.lineY(all.filter((r) => r.series === series), {
      x: "date", y: "count", stroke: "series", strokeWidth: 2, curve: "monotone-x",
      strokeDasharray: style.dash ?? undefined,
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
      domain: styled.map((s) => s.series),
      range: styled.map((s) => s.style.color),
    },
    marks: [
      Plot.ruleY([0]),
      ...styled.map(lineMark),
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
