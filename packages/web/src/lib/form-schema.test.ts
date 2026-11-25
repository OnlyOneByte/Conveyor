import { describe, expect, test } from "bun:test";
import type { FormUiHints } from "@conveyor/shared";
import {
  clamp,
  controlFor,
  fieldLabel,
  groupSummary,
  hi,
  lo,
  numOf,
  type Props,
  primaryGroups,
  resolveRoot,
} from "./form-schema";

const props: Props = {
  gridX: { type: "integer", minimum: 1, maximum: 8, default: 2 },
  gridY: { type: "integer", minimum: 1, maximum: 8, default: 3 },
  heightUnits: { type: "integer", minimum: 2, default: 6 },
  scoop: { type: "boolean", description: "Finger scoop" },
  note: { type: "string" },
};

describe("resolveRoot", () => {
  test("follows a $ref into its definitions, and keeps a schema without one", () => {
    const bin = { type: "object", properties: { gridX: props.gridX } };
    expect(resolveRoot({ $ref: "#/definitions/Bin", definitions: { Bin: bin } })).toBe(bin);
    const plain = { type: "object", properties: {} };
    expect(resolveRoot(plain)).toBe(plain);
    expect(resolveRoot(null)).toBeNull();
  });

  test("keeps the schema when the $ref names no definition", () => {
    const broken = { $ref: "#/definitions/Missing", definitions: {} };
    expect(resolveRoot(broken)).toBe(broken);
  });
});

describe("fieldLabel", () => {
  test("uses the description, else splits the camel-case key into words", () => {
    expect(fieldLabel("scoop", props.scoop)).toBe("Finger scoop");
    expect(fieldLabel("heightUnits", props.heightUnits)).toBe("Height Units");
    expect(fieldLabel("x", {})).toBe("X");
  });
});

describe("bounds", () => {
  test("an open bound is infinite, and clamp holds a value inside the bounds", () => {
    expect([lo(props.gridX), hi(props.gridX)]).toEqual([1, 8]);
    expect([lo({}), hi({})]).toEqual([Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY]);
    expect([clamp(0, props.gridX), clamp(9, props.gridX), clamp(4, props.gridX)]).toEqual([
      1, 8, 4,
    ]);
    expect(clamp(99, props.heightUnits)).toBe(99);
  });

  test("numOf reads the value, then the default, then the minimum, then 0", () => {
    expect(numOf(props, { gridX: 5 }, "gridX")).toBe(5);
    expect(numOf(props, {}, "gridX")).toBe(2);
    expect(numOf({ w: { minimum: 3 } }, {}, "w")).toBe(3);
    expect(numOf({}, {}, "missing")).toBe(0);
  });
});

describe("controlFor", () => {
  test("a hint wins; otherwise a boolean is a checkbox, a bounded number a slider, the rest steppers", () => {
    const ui: FormUiHints = { controls: { gridX: "stepper" } };
    expect(controlFor("gridX", props.gridX, ui)).toBe("stepper");
    expect(controlFor("gridY", props.gridY, ui)).toBe("slider");
    expect(controlFor("scoop", props.scoop, null)).toBe("checkbox");
    expect(controlFor("heightUnits", props.heightUnits, null)).toBe("stepper");
  });
});

describe("groupSummary", () => {
  test("fields with a millimetre unit read as a size", () => {
    const ui: FormUiHints = { unitMm: { gridX: 42, gridY: 42 } };
    const group = { fields: ["gridX", "gridY"], layout: "pair" as const };
    expect(groupSummary(group, props, { gridX: 2 }, ui)).toBe("84 × 126 mm");
  });

  test("several plain numbers read as a product, anything else as nothing", () => {
    const pair = { fields: ["gridX", "gridY"], layout: "pair" as const };
    expect(groupSummary(pair, props, { gridX: 4, gridY: 1 }, null)).toBe("4 × 1");
    expect(groupSummary({ fields: ["gridX"], layout: "stack" }, props, {}, null)).toBe("");
    expect(groupSummary({ fields: ["gridX", "scoop"], layout: "stack" }, props, {}, null)).toBe("");
    expect(groupSummary({ fields: ["unknown"], layout: "stack" }, props, {}, null)).toBe("");
  });
});

describe("primaryGroups", () => {
  test("without groups every field goes in one stack", () => {
    expect(primaryGroups(props, null)).toEqual([{ fields: Object.keys(props), layout: "stack" }]);
  });

  test("fields no group or advanced group names land in a last stack", () => {
    const ui: FormUiHints = {
      groups: [{ title: "Footprint", fields: ["gridX", "gridY"], layout: "pair" }],
      advanced: { groups: [{ title: "Extras", fields: ["scoop"], layout: "stack" }] },
    };
    expect(primaryGroups(props, ui)).toEqual([
      { title: "Footprint", fields: ["gridX", "gridY"], layout: "pair" },
      { fields: ["heightUnits", "note"], layout: "stack" },
    ]);
  });

  test("groups that name every field are used as they are", () => {
    const ui: FormUiHints = {
      groups: [{ title: "All", fields: Object.keys(props), layout: "stack" }],
    };
    expect(primaryGroups(props, ui)).toBe(ui.groups);
  });
});
