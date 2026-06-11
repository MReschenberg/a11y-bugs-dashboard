import { describe, it, expect } from "vitest";
import {
  mapSeverity, classifyResolution, isKnownResolution,
  isGraveyard, isExcludedProduct, isEngine, isWebaim, normalizeBug, KNOWN_SEVERITIES,
} from "../classify";
import type { RawBug } from "../schema";

describe("mapSeverity (§4.5)", () => {
  it("maps modern S-scale to itself", () => {
    expect(mapSeverity("S1")).toBe("S1");
    expect(mapSeverity("S2")).toBe("S2");
    expect(mapSeverity("S3")).toBe("S3");
    expect(mapSeverity("S4")).toBe("S4");
  });
  it("maps legacy values per the validated mapping (major→S3)", () => {
    expect(mapSeverity("blocker")).toBe("S1");
    expect(mapSeverity("critical")).toBe("S2");
    expect(mapSeverity("major")).toBe("S3"); // validated by sensitivity analysis
    expect(mapSeverity("normal")).toBe("S3");
    expect(mapSeverity("minor")).toBe("S4");
    expect(mapSeverity("trivial")).toBe("S4");
  });
  it("is case-insensitive", () => {
    expect(mapSeverity("Major")).toBe("S3");
    expect(mapSeverity("NORMAL")).toBe("S3");
  });
  it("returns 'unknown' for unset/blank, never folding it into an S", () => {
    expect(mapSeverity("--")).toBe("unknown");
    expect(mapSeverity("N/A")).toBe("unknown");
    expect(mapSeverity("")).toBe("unknown");
    expect(mapSeverity(null)).toBe("unknown");
    expect(mapSeverity(undefined)).toBe("unknown");
  });
});

describe("classifyResolution (§4.4)", () => {
  it("maps each observed resolution to its bucket", () => {
    expect(classifyResolution("FIXED")).toBe("fixed");
    expect(classifyResolution("WONTFIX")).toBe("wontfix");
    expect(classifyResolution("INCOMPLETE")).toBe("incomplete");
    expect(classifyResolution("INACTIVE")).toBe("incomplete");
    expect(classifyResolution("DUPLICATE")).toBe("duplicate");
    expect(classifyResolution("INVALID")).toBe("invalid");
    expect(classifyResolution("WORKSFORME")).toBe("invalid");
    expect(classifyResolution("EXPIRED")).toBe("other_closed");
    expect(classifyResolution("MOVED")).toBe("other_closed");
  });
  it("treats empty resolution as open", () => {
    expect(classifyResolution("")).toBe("open");
  });
  it("isKnownResolution flags surprises (validator hook)", () => {
    expect(isKnownResolution("FIXED")).toBe(true);
    expect(isKnownResolution("")).toBe(true);
    expect(isKnownResolution("SOMETHING_NEW")).toBe(false);
  });
});

describe("population flags (R13)", () => {
  it("detects graveyard products", () => {
    expect(isGraveyard("Firefox OS Graveyard")).toBe(true);
    expect(isGraveyard("Core Graveyard")).toBe(true);
    expect(isGraveyard("Core")).toBe(false);
    expect(isGraveyard("Firefox")).toBe(false);
  });
  it("excludes graveyard + the Thunderbird family, keeps the rest", () => {
    expect(isExcludedProduct("Thunderbird")).toBe(true);
    expect(isExcludedProduct("SeaMonkey")).toBe(true);
    expect(isExcludedProduct("MailNews Core")).toBe(true);
    expect(isExcludedProduct("Calendar")).toBe(true);
    expect(isExcludedProduct("Camino Graveyard")).toBe(true);
    expect(isExcludedProduct("Core")).toBe(false);
    expect(isExcludedProduct("Firefox")).toBe(false);
    expect(isExcludedProduct("DevTools")).toBe(false);
  });
  it("detects the a11y engine", () => {
    expect(isEngine("Core", "Disability Access APIs")).toBe(true);
    expect(isEngine("Core", "Layout")).toBe(false);
    expect(isEngine("Firefox", "Disability Access")).toBe(false); // engine = Core only
  });
  it("flags WebAIM contractor filings (case-insensitive)", () => {
    expect(isWebaim("john.northup@usu.edu")).toBe(true);
    expect(isWebaim("John.Northup@USU.edu")).toBe(true);
    expect(isWebaim("someone@mozilla.com")).toBe(false);
    expect(isWebaim(undefined)).toBe(false);
  });
});

describe("KNOWN_SEVERITIES guards the validator", () => {
  it("contains every value we map plus unset forms", () => {
    for (const v of ["s1", "blocker", "major", "normal", "--", "n/a", "", "enhancement"]) {
      expect(KNOWN_SEVERITIES.has(v)).toBe(true);
    }
    expect(KNOWN_SEVERITIES.has("catastrophic")).toBe(false);
  });
});

describe("normalizeBug", () => {
  const base: RawBug = {
    id: 1, creation_time: "2024-01-01T00:00:00Z", cf_last_resolved: "2024-02-01T00:00:00Z",
    status: "RESOLVED", resolution: "FIXED", severity: "major", product: "Core",
    component: "Disability Access APIs", creator: "dev@mozilla.com", groups: [],
  };
  it("normalizes severity, bucket, and flags", () => {
    const n = normalizeBug(base);
    expect(n).toMatchObject({
      id: 1, severity: "S3", bucket: "fixed", isEngine: true, excluded: false,
      webaim: false, restricted: false, resolved: "2024-02-01T00:00:00Z",
    });
  });
  it("excludes Thunderbird/SeaMonkey and flags WebAIM filings", () => {
    expect(normalizeBug({ ...base, product: "Thunderbird" }).excluded).toBe(true);
    expect(normalizeBug({ ...base, creator: "john.northup@usu.edu" }).webaim).toBe(true);
  });
  it("marks restricted bugs by non-empty groups", () => {
    expect(normalizeBug({ ...base, groups: ["core-security"] }).restricted).toBe(true);
  });
  it("treats missing cf_last_resolved as unresolved (open)", () => {
    const n = normalizeBug({ ...base, resolution: "", cf_last_resolved: null });
    expect(n.bucket).toBe("open");
    expect(n.resolved).toBeNull();
  });
});
