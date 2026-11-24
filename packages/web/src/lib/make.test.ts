import { describe, expect, test } from "bun:test";
import type { FormUiHints } from "@conveyor/shared";
import { dockLine, fileSize, measurements, printerStatus } from "./make.js";

const ui: FormUiHints = {
  groups: [
    { title: "Footprint", fields: ["gridX", "gridY"], layout: "pair" },
    { title: "Height", fields: ["heightUnits"] },
  ],
  advanced: { title: "More options", groups: [{ fields: ["divisionsX"] }] },
  unitMm: { gridX: 42, gridY: 42, heightUnits: 7, divisionsX: 1 },
};

describe("measurements", () => {
  test("multiplies each grouped field by its unit, in the form's order", () => {
    expect(measurements({ gridX: 2, gridY: 3, heightUnits: 6 }, ui)).toBe("84 × 126 × 42 mm");
  });

  test("skips missing values and fields outside the main groups", () => {
    expect(measurements({ gridX: 1, heightUnits: 3, divisionsX: 4 }, ui)).toBe("42 × 21 mm");
    expect(measurements({}, ui)).toBe("");
    expect(measurements({ gridX: 2 }, null)).toBe("");
  });
});

describe("printerStatus", () => {
  test("says Not reachable before Busy, and Ready otherwise", () => {
    const busy = new Set(["voron", "ender"]);
    const unreachable = new Set(["ender"]);
    expect(["voron", "ender", "prusa"].map((id) => printerStatus(id, busy, unreachable))).toEqual([
      "Busy",
      "Not reachable",
      "Ready",
    ]);
  });
});

describe("fileSize", () => {
  test("rounds to whole KB under a MB, never below 1 KB, and to a tenth of a MB above", () => {
    expect([0, 200, 1536, 1024 * 1024 - 1, 1024 * 1024, 5.25 * 1024 * 1024].map(fileSize)).toEqual([
      "1 KB",
      "1 KB",
      "2 KB",
      "1024 KB",
      "1.0 MB",
      "5.3 MB",
    ]);
  });
});

describe("dockLine", () => {
  test("joins only the parts that are there", () => {
    expect(dockLine("84 × 126 mm", undefined, "PLA 0.2mm")).toBe("84 × 126 mm · PLA 0.2mm");
    expect(dockLine("", undefined)).toBe("");
  });
});
