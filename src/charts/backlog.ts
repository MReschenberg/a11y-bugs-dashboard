// Open-backlog trend chart (FR-2 over time): a single metric line over ISO weeks.
// Pure builder — returns a fresh DOM node.
import * as Plot from "@observablehq/plot";

export interface TrendPoint {
  date: Date;
  value: number;
  week: string;
}

export function backlogFigure(
  points: TrendPoint[],
  opts: { label: string; color: string; backfillUntil?: Date | null },
): HTMLElement | SVGSVGElement {
  return Plot.plot({
    width: 880,
    height: 232,
    marginLeft: 56,
    marginBottom: 48, // room for two-line "Mon \n YYYY" tick labels (were getting clipped)
    style: { fontSize: "13px", background: "transparent" },
    x: { type: "utc", label: null, grid: false },
    y: { label: opts.label, grid: true, nice: true, zero: true },
    marks: [
      Plot.ruleY([0]),
      // Mark the backfilled (reconstructed) span: a rule + note at the boundary where
      // authoritative frozen snapshots begin (only present once weeks have been frozen).
      ...(opts.backfillUntil
        ? [
            Plot.ruleX([opts.backfillUntil], { stroke: "currentColor", strokeOpacity: 0.4, strokeDasharray: "3 3" }),
            Plot.text([opts.backfillUntil], {
              x: (d: Date) => d, y: 0, frameAnchor: "top-left", dx: 6, dy: 4,
              text: () => "← reconstructed", fontSize: 11, fillOpacity: 0.7,
            }),
          ]
        : []),
      Plot.lineY(points, {
        x: "date", y: "value", stroke: opts.color, strokeWidth: 2, curve: "monotone-x",
        ariaLabel: (d: TrendPoint) => `${opts.label}: ${d.value} in week ${d.week}`,
      }),
      Plot.tip(points, Plot.pointerX({ x: "date", y: "value", channels: { Week: "week", Value: "value" } })),
    ],
    ariaLabel: `${opts.label} over time`,
  });
}
