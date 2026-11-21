import { describe, expect, test } from "bun:test";
import type { Coverage } from "./lcov";
import {
  mergeCoverage,
  nonBlankLines,
  packageOf,
  percents,
  summarize,
  sweepErrors,
} from "./summary";

describe("sweepErrors", () => {
  test("a clean sweep has no errors", () => {
    expect(sweepErrors({ completed: true, failed: [], estimated: [] })).toEqual([]);
  });

  test("an estimated file, a throwing import or a dead sweep each fail", () => {
    expect(sweepErrors({ completed: true, failed: [], estimated: ["a.ts"] })).toEqual([
      "coverage sweep: a.ts has no line map",
    ]);
    expect(sweepErrors({ completed: true, failed: ["b.ts"], estimated: [] })).toEqual([
      "coverage sweep: b.ts threw while importing",
    ]);
    expect(sweepErrors({ completed: false, failed: [], estimated: [] })).toHaveLength(1);
  });
});

const lcov = (entries: Record<string, [number, number][]>): Coverage =>
  new Map(Object.entries(entries).map(([file, lines]) => [file, new Map(lines)]));

describe("coverage merge", () => {
  test("classifies only package sources", () => {
    expect(packageOf("packages/api/src/routes/jobs.ts")).toBe("api");
    expect(packageOf("packages/api/src/auth.test.ts")).toBeNull();
    expect(packageOf("packages/web/src/app.ts")).toBeNull();
    expect(packageOf("packages/shared/test/helpers/db.ts")).toBeNull();
    expect(packageOf("plugins/slicers/orca/src/index.ts")).toBe("plugins");
    expect(packageOf("plugins/slicers/orca/src/index.test.ts")).toBeNull();
    expect(packageOf("packages/plugins/src/x.ts")).toBeNull();
  });

  test("a file moved out of src or renamed to spec style keeps or leaves the metric honestly", () => {
    expect(packageOf("packages/api/lib/moved.ts")).toBe("api");
    expect(packageOf("plugins/slicers/orca/lib/index.ts")).toBe("plugins");
    expect(packageOf("packages/api/src/auth.spec.ts")).toBeNull();
    expect(packageOf("plugins/slicers/orca/test/fake.ts")).toBeNull();
    expect(packageOf("packages/api/src/types.d.ts")).toBeNull();
    expect(packageOf("packages/api/src/data.json")).toBeNull();
  });

  const A = "packages/api/src/a.ts";
  const B = "packages/api/src/b.ts";
  const C = "packages/worker/src/c.ts";

  const sweep = lcov({
    [A]: [
      [1, 1],
      [2, 1],
      [3, 1],
      [4, 1],
    ],
    [B]: [
      [1, 5],
      [2, 5],
    ],
  });

  const merge = (measured: Coverage) =>
    mergeCoverage({
      sources: [A, B, C],
      measured,
      sweep,
      fallback: () => nonBlankLines("x\n\ny\n"),
    });

  test("counts unloaded files at zero using the sweep line map", () => {
    const merged = merge(new Map());
    expect(merged.unloaded).toEqual([A, B, C]);
    expect(merged.estimated).toEqual([C]);
    const summary = summarize(merged.coverage);
    expect(summary.api).toEqual({ found: 6, hit: 0 });
    expect(summary.worker).toEqual({ found: 2, hit: 0 });
    expect(percents(summary)).toEqual({ api: 0, worker: 0, shared: 100, plugins: 100 });
  });

  test("a test that loads a file cannot move its denominator", () => {
    const before = summarize(merge(new Map()).coverage);
    const run = lcov({
      [A]: [
        [1, 3],
        [3, 0],
        [9, 1],
      ],
    });
    const merged = merge(run);
    const after = summarize(merged.coverage);
    expect(merged.unloaded).toEqual([B, C]);
    expect(after.api.found).toBe(before.api.found);
    expect(after.worker.found).toBe(before.worker.found);
    expect(merged.coverage.get(A)).toEqual(
      new Map([
        [1, 3],
        [2, 0],
        [3, 0],
        [4, 0],
      ]),
    );
    expect(after.api).toEqual({ found: 6, hit: 1 });
  });

  test("removing comment lines cannot lower a file's coverage", () => {
    const path = "packages/shared/src/x.ts";
    const percentOf = (sweepLines: number[], hitLines: number[]) => {
      const merged = mergeCoverage({
        sources: [path],
        measured: new Map([[path, new Map(hitLines.map((line) => [line, 1]))]]),
        sweep: new Map([[path, new Map(sweepLines.map((line) => [line, 0]))]]),
        fallback: () => new Map(),
      });
      return percents(summarize(merged.coverage)).shared;
    };
    const withComments = percentOf([1, 2, 3, 4, 5, 6], [1, 4, 6]);
    const withoutComments = percentOf([1, 2, 3, 4], [1, 3, 4]);
    expect(withComments).toBe(50);
    expect(withoutComments).toBe(75);
    expect(withoutComments).toBeGreaterThanOrEqual(withComments);
  });
});
