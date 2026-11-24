import { describe, expect, test } from "bun:test";
import type { FormUiHints } from "@conveyor/shared";
import type { JsonSchema } from "./form-schema.js";
import { duration, jobName, settingRows } from "./job-settings.js";

const schema: JsonSchema = {
  $ref: "#/definitions/Bin",
  definitions: {
    Bin: {
      type: "object",
      properties: {
        gridX: { type: "integer", description: "Width in 42mm units" },
        gridY: { type: "integer", description: "Depth in 42mm units" },
        heightUnits: { type: "integer", description: "Height in 7mm units" },
        divisionsX: { type: "integer", description: "Compartments across" },
        magnetHoles: { type: "boolean", description: "Magnet holes in base" },
      },
    },
  },
};

const ui: FormUiHints = {
  groups: [
    { title: "Footprint", fields: ["gridX", "gridY"], layout: "pair" },
    { title: "Height", fields: ["heightUnits"], layout: "stack" },
  ],
  advanced: {
    title: "More options",
    groups: [{ fields: ["magnetHoles", "divisionsX"], layout: "grid" }],
  },
  unitMm: { gridX: 42, gridY: 42, heightUnits: 7 },
};

describe("settingRows", () => {
  test("uses the form's labels, its order and its units", () => {
    const params = { divisionsX: 2, magnetHoles: true, gridY: 3, gridX: 2 };
    expect(settingRows(params, schema, ui)).toEqual([
      { key: "gridX", label: "Width in 42mm units", value: "2 u · 84 mm" },
      { key: "gridY", label: "Depth in 42mm units", value: "3 u · 126 mm" },
      { key: "magnetHoles", label: "Magnet holes in base", value: "Yes" },
      { key: "divisionsX", label: "Compartments across", value: "2" },
    ]);
  });

  test("names a field the schema lacks from its key, and hides ids and nested values", () => {
    const params = { lidStyle: "snap", uploadId: "0b1c…", extra: { a: 1 }, gridX: 1 };
    expect(settingRows(params, schema, null)).toEqual([
      { key: "gridX", label: "Width in 42mm units", value: "1" },
      { key: "lidStyle", label: "Lid Style", value: "snap" },
    ]);
  });

  test("returns nothing for params that are not an object", () => {
    expect(settingRows(undefined, schema, ui)).toEqual([]);
    expect(settingRows([1, 2], schema, ui)).toEqual([]);
  });
});

describe("jobName", () => {
  test("is the generator's name, its footprint and its height in units", () => {
    expect(jobName("Gridfinity Bin", { gridX: 2, gridY: 3, heightUnits: 6 }, schema, ui)).toBe(
      "Gridfinity Bin 2×3 · 6u",
    );
  });

  test("leaves out a size the params don't have", () => {
    expect(jobName("Gridfinity Bin", { gridX: 2, gridY: 3 }, schema, ui)).toBe(
      "Gridfinity Bin 2×3",
    );
    expect(jobName("Gridfinity Bin", { heightUnits: 6 }, schema, ui)).toBe("Gridfinity Bin 6u");
  });

  test("adds a single field's value only when the form gives it a unit", () => {
    const counted: FormUiHints = { groups: [{ fields: ["count"], layout: "stack" }] };
    expect(jobName("Thing", { count: 4 }, null, counted)).toBe("Thing");
    const unit = { ...counted, unitMm: { count: 7 } };
    expect(jobName("Thing", { count: 4 }, null, unit)).toBe("Thing 4u");
  });

  test("names only from the form's groups, never from fields it leaves ungrouped", () => {
    const params = { a: 1, b: 2, c: 3, d: 4 };
    expect(jobName("Thing", params, null, null)).toBe("Thing");
    const pair: FormUiHints = { groups: [{ fields: ["a", "b"], layout: "pair" }] };
    expect(jobName("Thing", params, null, pair)).toBe("Thing 1×2");
  });

  test("is the file name for an uploaded model", () => {
    expect(jobName("Upload", { uploadId: "x", filename: "bracket.stl" }, null, null)).toBe(
      "bracket.stl",
    );
  });

  test("falls back to the generator's name", () => {
    expect(jobName("Gridfinity Bin", null, schema, ui)).toBe("Gridfinity Bin");
    expect(jobName("Gridfinity Bin", { gridX: 2 }, schema, null)).toBe("Gridfinity Bin");
  });
});

describe("duration", () => {
  test("reads in seconds, minutes, then hours and minutes", () => {
    expect([1400, 41_000, 59_400, 59_600, 600_000, 3_600_000, 4_326_000].map(duration)).toEqual([
      "1 s",
      "41 s",
      "59 s",
      "1 min",
      "10 min",
      "1 h",
      "1 h 12 min",
    ]);
  });
});
