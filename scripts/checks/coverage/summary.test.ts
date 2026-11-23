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
    expect(packageOf("packages/web/src/app.ts")).toBeNull();
    expect(packageOf("plugins/slicers/orca/src/index.ts")).toBe("plugins");
    expect(packageOf("packages/plugins/src/x.ts")).toBeNull();
    expect(packageOf("packages/api/lib/moved.ts")).toBe("api");
    expect(packageOf("plugins/slicers/orca/lib/index.ts")).toBe("plugins");
    expect(packageOf("packages/api/src/types.d.ts")).toBeNull();
    expect(packageOf("packages/api/src/data.json")).toBeNull();
  });
});

const MODULE = "export const total = (items: number[]) => items.length;\n";

const IMPORT = 'import { describe, it, test } from "bun:test";\n';

const SUITE = `${IMPORT}test("adds", () => {});\n`;

describe("isSource", () => {
  test("a spec or test file that imports bun:test is a test", () => {
    expect(isSource("packages/api/src/auth.test.ts", () => SUITE)).toBe(false);
    expect(isSource("packages/api/src/auth.spec.ts", () => SUITE)).toBe(false);
    expect(
      isSource(
        "packages/worker/src/run.test.ts",
        () => `${IMPORT}describe.each([1])('x', () => {});\n`,
      ),
    ).toBe(false);
  });

  test("suites in every code extension are tests", () => {
    for (const name of ["a.test.js", "a.test.mts", "a.spec.mjs", "a.test.tsx", "a.spec.cts"]) {
      expect(isSource(`packages/api/src/${name}`, () => SUITE)).toBe(false);
    }
  });

  test("a suite that calls bun:test through an alias or a namespace is a test", () => {
    const suites = [
      'import { test as check } from "bun:test";\ncheck("x", () => {});\n',
      'import * as bt from "bun:test";\nbt.test("x", () => {});\n',
      'import "bun:test";\n',
      'const { test: t } = require("bun:test");\nt("x", () => {});\n',
      'const bt = await import("bun:test");\nbt.it("x", () => {});\n',
    ];
    for (const text of suites) {
      expect(isSource("packages/api/src/inflate.test.ts", () => text)).toBe(false);
    }
  });

  test("a module that is not test-named counts even when it imports bun:test", () => {
    const text = 'import { mock } from "bun:test";\nexport const fake = mock(() => 1);\n';
    expect(isSource("packages/shared/src/fakes.ts", () => text)).toBe(true);
    expect(isSource("plugins/slicers/orca/test/fake-slicer.ts", () => text)).toBe(true);
  });

  test("a spec-named module that never imports bun:test counts", () => {
    expect(isSource("packages/api/src/openapi.spec.ts", () => MODULE)).toBe(true);
    expect(
      isSource(
        "packages/api/src/hint.spec.ts",
        () => 'export const hint = "call test(x) first, see bun:test";\n',
      ),
    ).toBe(true);
    expect(
      isSource("packages/api/src/view.spec.ts", () => "const test = (n: number) => n;\ntest(2);\n"),
    ).toBe(true);
  });

  test("a module in a package test folder outside the declared helpers counts", () => {
    expect(isSource("plugins/slicers/orca/test/fake.ts", () => MODULE)).toBe(true);
    expect(isSource("packages/api/test/server.ts", () => MODULE)).toBe(true);
  });

  test("the declared test helper folders are excluded whatever they contain", () => {
    expect(TEST_HELPER_DIRS).toEqual([
      "packages/shared/test/helpers/",
      "packages/worker/test/helpers/",
    ]);
    expect(isSource("packages/shared/test/helpers/db.ts", () => MODULE)).toBe(false);
    expect(isTestFile("packages/shared/test/helpers/db.ts", MODULE)).toBe(true);
    expect(isSource("packages/worker/test/helpers/loop-harness.ts", () => MODULE)).toBe(false);
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
        typeLines: () => new Set(),
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
