import { describe, expect, test } from "bun:test";
import type { Coverage } from "./lcov";
import {
  DEFAULT_SWEEP_TIMEOUT_MS,
  isSource,
  isTestFile,
  mergeCoverage,
  nonBlankLines,
  packageOf,
  percents,
  SWEEP_TIMEOUT_ENV,
  summarize,
  sweepErrors,
  sweepTimeoutMs,
  TEST_HELPER_DIRS,
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
    expect(packageOf("packages/web/src/lib/api.ts")).toBe("web");
    expect(packageOf("packages/web/src/lib/components/Viewport.svelte")).toBeNull();
    expect(packageOf("plugins/slicers/orca/src/index.ts")).toBe("plugins");
    expect(packageOf("packages/plugins/src/x.ts")).toBeNull();
    expect(packageOf("packages/api/lib/moved.ts")).toBe("api");
    expect(packageOf("plugins/slicers/orca/lib/index.ts")).toBe("plugins");
    expect(packageOf("packages/api/src/types.d.ts")).toBeNull();
    expect(packageOf("packages/api/src/data.json")).toBeNull();
  });
});

describe("isSource", () => {
  test("a test- or spec-named file in any code extension is a test", () => {
    for (const name of [
      "a.test.ts",
      "a.spec.ts",
      "a.test.js",
      "a.test.mts",
      "a.spec.mjs",
      "a.test.tsx",
    ]) {
      expect(isSource(`packages/api/src/${name}`)).toBe(false);
    }
  });

  test("the file name decides, not whether the text mentions bun:test", () => {
    expect(isTestFile("packages/api/src/hint.ts")).toBe(false);
    expect(isSource("packages/api/src/hint.ts")).toBe(true);
    expect(isSource("packages/shared/src/fakes.ts")).toBe(true);
    expect(isSource("packages/api/src/openapi.spec.ts")).toBe(false);
  });

  test("a module in a package test folder outside the declared helpers counts", () => {
    expect(isSource("plugins/slicers/orca/test/fake.ts")).toBe(true);
    expect(isSource("packages/api/test/server.ts")).toBe(true);
  });

  test("the declared test helper folders are excluded whatever they contain", () => {
    expect(TEST_HELPER_DIRS).toEqual([
      "packages/api/test/helpers/",
      "packages/shared/test/helpers/",
      "packages/worker/test/helpers/",
      "packages/web/test/helpers/",
    ]);
    expect(isSource("packages/web/test/helpers/dom.ts")).toBe(false);
    expect(isSource("packages/api/test/helpers/booted-api.ts")).toBe(false);
    expect(isSource("packages/shared/test/helpers/db.ts")).toBe(false);
    expect(isTestFile("packages/shared/test/helpers/db.ts")).toBe(true);
    expect(isSource("packages/worker/test/helpers/loop-harness.ts")).toBe(false);
  });
});

describe("sweepTimeoutMs", () => {
  test("defaults to thirty seconds", () => {
    expect(DEFAULT_SWEEP_TIMEOUT_MS).toBe(30_000);
    expect(sweepTimeoutMs({})).toBe(30_000);
    expect(sweepTimeoutMs({ [SWEEP_TIMEOUT_ENV]: "" })).toBe(30_000);
  });

  test("reads a positive millisecond count from the environment", () => {
    expect(SWEEP_TIMEOUT_ENV).toBe("CONVEYOR_COVERAGE_SWEEP_TIMEOUT_MS");
    expect(sweepTimeoutMs({ [SWEEP_TIMEOUT_ENV]: "5000" })).toBe(5000);
  });

  test("rejects a value that is not a positive integer", () => {
    for (const raw of ["0", "-1", "1.5", "soon"]) {
      expect(sweepTimeoutMs({ [SWEEP_TIMEOUT_ENV]: raw })).toBeInstanceOf(Error);
    }
  });
});

describe("coverage totals", () => {
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
      typeLines: () => new Set(),
      bodies: () => [],
    });

  test("counts unloaded files at zero using the sweep line map", () => {
    const merged = merge(new Map());
    expect(merged.unloaded).toEqual([A, B, C]);
    expect(merged.estimated).toEqual([C]);
    const summary = summarize(merged.coverage);
    expect(summary.api).toEqual({ found: 6, hit: 0 });
    expect(summary.worker).toEqual({ found: 2, hit: 0 });
    expect(percents(summary)).toEqual({ api: 0, worker: 0, shared: 100, plugins: 100, web: 100 });
  });

  test("a loaded file counts the lines bun's run lists, not the sweep's blanks and braces", () => {
    const run = lcov({
      [A]: [
        [1, 3],
        [3, 0],
        [9, 1],
      ],
    });
    const merged = merge(run);
    expect(merged.unloaded).toEqual([B, C]);
    expect(merged.coverage.get(A)).toEqual(
      new Map([
        [1, 3],
        [3, 0],
        [9, 1],
      ]),
    );
    expect(summarize(merged.coverage).api).toEqual({ found: 3 + 2, hit: 2 });
  });

  test("an unloaded file still counts every line the sweep maps, at zero", () => {
    const merged = merge(lcov({ [A]: [[1, 1]] }));
    expect(merged.coverage.get(B)).toEqual(
      new Map([
        [1, 0],
        [2, 0],
      ]),
    );
    expect(summarize(merged.coverage).worker).toEqual({ found: 2, hit: 0 });
  });

  test("a loaded file's function that never ran counts 0 on every line, its last included", () => {
    const merged = mergeCoverage({
      sources: [A],
      measured: lcov({
        [A]: [
          [1, 4],
          [2, 0],
          [3, 2],
        ],
      }),
      sweep,
      fallback: () => new Map(),
      typeLines: () => new Set(),
      bodies: () => [{ header: 1, first: 2, last: 3 }],
    });
    expect(summarize(merged.coverage).api).toEqual({ found: 3, hit: 1 });
  });

  test("removing comment lines cannot lower a file's coverage", () => {
    const path = "packages/shared/src/x.ts";
    const percentOf = (sweepLines: number[], run: [number, number][]) => {
      const merged = mergeCoverage({
        sources: [path],
        measured: new Map([[path, new Map(run)]]),
        sweep: new Map([[path, new Map(sweepLines.map((line) => [line, 0]))]]),
        fallback: () => new Map(),
        typeLines: () => new Set(),
        bodies: () => [],
      });
      return percents(summarize(merged.coverage)).shared;
    };
    const withComments = percentOf(
      [1, 2, 3, 4, 5, 6],
      [
        [1, 1],
        [4, 1],
        [6, 0],
      ],
    );
    const withoutComments = percentOf(
      [1, 2, 3, 4],
      [
        [1, 1],
        [3, 1],
        [4, 0],
      ],
    );
    expect(withComments).toBe(66.67);
    expect(withoutComments).toBe(66.67);
  });
});
