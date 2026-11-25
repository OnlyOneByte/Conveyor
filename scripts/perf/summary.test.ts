import { describe, expect, test } from "bun:test";
import { median, readRun, shortfall, summarize } from "./summary";

const lighthouse = (values: Record<string, number>, extra: object = {}) =>
  JSON.stringify({
    audits: Object.fromEntries(Object.entries(values).map(([id, v]) => [id, { numericValue: v }])),
    ...extra,
  });

describe("median", () => {
  test("takes the middle value, or the mean of the two middle ones", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe("readRun", () => {
  test("reads the four metrics from a Lighthouse report", () => {
    expect(readRun(lighthouse({ interactive: 3000, "first-contentful-paint": 1200 }))).toEqual({
      interactive: 3000,
      "first-contentful-paint": 1200,
    });
  });

  test("drops a run Lighthouse reports as failed", () => {
    expect(
      readRun(lighthouse({ interactive: 1 }, { runtimeError: { code: "NO_FCP" } })),
    ).toBeNull();
  });
});

describe("summarize", () => {
  test("puts each metric's median side by side with the change", () => {
    const table = summarize(
      [{ interactive: 3000 }, { interactive: 3400 }, { interactive: 3200 }],
      [{ interactive: 2900 }, { interactive: 3100 }],
      { base: "main", head: "patch" },
    );
    expect(table).toContain("| Median | main (3 runs) | patch (2 runs) | Change |");
    expect(table).toContain("| Time to interactive | 3,200 ms | 3,000 ms | -200 ms |");
    expect(table).toContain("| First contentful paint | n/a | n/a | n/a |");
  });

  test("shows a change under half a millisecond as 0, not -0", () => {
    expect(summarize([{ interactive: 2703 }], [{ interactive: 2702.6 }])).toContain(
      "| Time to interactive | 2,703 ms | 2,703 ms | 0 ms |",
    );
  });
});

describe("shortfall", () => {
  test("names each side with fewer than half its runs", () => {
    expect(shortfall({ main: 4, patch: 0 }, 10)).toEqual([
      "main has 4 of 10 runs; at least half must succeed",
      "patch has 0 of 10 runs; at least half must succeed",
    ]);
  });

  test("passes at exactly half, rounding an odd count up", () => {
    expect(shortfall({ main: 5, patch: 10 }, 10)).toEqual([]);
    expect(shortfall({ main: 3 }, 5)).toEqual([]);
    expect(shortfall({ main: 2 }, 5)).toEqual(["main has 2 of 5 runs; at least half must succeed"]);
  });
});
