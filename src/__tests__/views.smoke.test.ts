// @vitest-environment jsdom
// Smoke test: build every view from the REAL generated JSON and assert it renders
// without throwing and contains expected content. Catches runtime DOM/data-access
// bugs the typecheck and bundle can't (e.g. undefined access, wrong shape).
import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { DashboardData } from "../data";
import { throughputView } from "../views/throughput";
import { agingView } from "../views/aging";
import { backlogView } from "../views/backlog";
import { comparisonView } from "../views/comparison";
import { aboutView, stalenessBanner } from "../views/about";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "data");
const read = async (n: string) => JSON.parse(await readFile(join(DATA, n), "utf8"));

let data: DashboardData;
beforeAll(async () => {
  data = {
    meta: await read("meta.json"),
    rollups: await read("rollups.json"),
    aging: await read("aging.json"),
    current: await read("current.json"),
    backlog: await read("backlog.json"),
  };
});

describe("views render against real data", () => {
  it("throughput (FR-1) renders a chart + table without throwing", () => {
    const el = throughputView(data);
    expect(el.querySelector("h2")?.textContent).toMatch(/Filed vs\. fixed/);
    expect(el.querySelector("svg, figure")).toBeTruthy(); // Plot output
    expect(el.querySelector("table")).toBeTruthy();        // data-table mirror
    expect(el.querySelectorAll('input[type="checkbox"]').length).toBeGreaterThan(0);
  });

  it("throughput (FR-1) offers a 'show' toggle per broken-out component that adds an overlay", () => {
    const el = throughputView(data);
    // One labelled checkbox per component, named "show <label>".
    for (const c of data.rollups.components) {
      const label = el.querySelector<HTMLLabelElement>(`label[for="fr1-comp-${c.key}"]`);
      expect(label?.textContent?.trim()).toBe(`show ${c.label}`);
    }
    // Toggling one on adds a "Fixed <label>" data-table column (and so an overlay line).
    const first = data.rollups.components[0];
    const overlayHeader = `Fixed ${first.label}`;
    const cb = el.querySelector<HTMLInputElement>(`#fr1-comp-${first.key}`)!;
    expect([...el.querySelectorAll("th")].map((th) => th.textContent)).not.toContain(overlayHeader);
    cb.checked = true;
    cb.dispatchEvent(new Event("change"));
    expect([...el.querySelectorAll("th")].map((th) => th.textContent)).toContain(overlayHeader);
  });

  it("aging (FR-2) shows the stats table + open backlog + raw-severity audit", () => {
    const el = agingView(data);
    expect(el.textContent).toMatch(/Time to close/i);
    expect(el.textContent).toMatch(/Open backlog/i);
    // raw-severity audit lists a known legacy value
    expect(el.textContent).toMatch(/normal|major|blocker/);
    expect(el.querySelector("td.emph")).toBeTruthy(); // median emphasized
  });

  it("backlog (FR-2 trend) renders count + age charts and a table", () => {
    const el = backlogView(data);
    expect(el.textContent).toMatch(/Open backlog over time/i);
    expect(el.querySelectorAll("svg, figure").length).toBeGreaterThanOrEqual(2); // count + age
    expect(el.querySelector("table")).toBeTruthy();
    expect(el.textContent).toMatch(/reconstructed/); // backfill source label
  });

  it("comparison (FR-3) renders YoY + MoM numeric tables", () => {
    const el = comparisonView(data);
    expect(el.querySelectorAll("table").length).toBe(2);
    expect(el.textContent).toMatch(/Year/);
    expect(el.textContent).toMatch(/Δ filed/);
  });

  it("about (FR-5) renders caveats + dictionary + severity map", () => {
    const el = aboutView(data);
    expect(el.textContent).toMatch(/Caveats/);
    expect(el.textContent).toMatch(/Data dictionary/);
    expect(el.textContent).toMatch(/Severity mapping/);
  });

  it("staleness banner is null for fresh data", () => {
    // meta.lastSuccessfulIngest was just generated, so no banner.
    expect(stalenessBanner(data)).toBeNull();
  });
});
