import { describe, expect, test } from "bun:test";
import { parseQuery, printProgressOf } from "./query.ts";

const objects = (printStats: Record<string, unknown>, fileProgress?: number) =>
  parseQuery({
    result: {
      status: {
        print_stats: printStats,
        ...(fileProgress === undefined ? {} : { virtual_sdcard: { progress: fileProgress } }),
      },
    },
  });

describe("moonraker print progress", () => {
  test("estimates time left from elapsed print time and file progress, in whole seconds", () => {
    expect(printProgressOf(objects({ print_duration: 100 }, 0.3))).toStrictEqual({
      secondsLeft: 233,
    });
    expect(printProgressOf(objects({ print_duration: 50 }, 0.01))).toStrictEqual({
      secondsLeft: 4950,
    });
  });

  test.each([
    ["no elapsed time", { print_duration: 0 }, 0.5],
    ["no file progress", { print_duration: 60 }, undefined],
    ["under 1% through the file", { print_duration: 60 }, 0.009],
    ["at the end of the file", { print_duration: 60 }, 1],
  ])("gives no time left with %s", (_, printStats, fileProgress) => {
    expect(printProgressOf(objects(printStats, fileProgress))).toBeUndefined();
  });

  test("keeps layer 0 and drops a zero or missing layer count", () => {
    expect(printProgressOf(objects({ info: { current_layer: 0, total_layer: 0 } }))).toStrictEqual({
      layer: 0,
    });
    expect(
      printProgressOf(objects({ info: { current_layer: null, total_layer: 9 } })),
    ).toStrictEqual({
      layers: 9,
    });
    expect(printProgressOf(objects({ info: null }))).toBeUndefined();
  });

  test("reads an empty reply as no printer objects", () => {
    expect(parseQuery({})).toStrictEqual({});
    expect(parseQuery({ result: {} })).toStrictEqual({});
  });

  test.each([
    ["a negative layer", { print_stats: { info: { current_layer: -1 } } }],
    ["a fractional layer count", { print_stats: { info: { total_layer: 2.5 } } }],
    ["a negative print time", { print_stats: { print_duration: -1 } }],
    ["a text progress", { virtual_sdcard: { progress: "half" } }],
  ])("refuses a reply with %s", (_, status) => {
    expect(() => parseQuery({ result: { status } })).toThrow("moonraker status: unexpected reply");
  });
});
