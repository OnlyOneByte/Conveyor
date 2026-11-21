import { describe, expect, test } from "bun:test";
import { type Coverage, exactHits, parseLcov, serializeLcov } from "./lcov";
import {
  BASELINE_PATH,
  CHECKER_PATH,
  checkRatchet,
  type Percents,
  parseBaseline,
  raisedBaseline,
  serializeBaseline,
  updateRefusal,
} from "./ratchet";
import {
  mergeCoverage,
  nonBlankLines,
  packageOf,
  percents,
  summarize,
  sweepErrors,
} from "./summary";

const json = (lines: Percents) => serializeBaseline({ lines });

const all = (value: number): Percents => ({
  api: value,
  worker: value,
  shared: value,
  plugins: value,
});

interface Case {
  current: Percents;
  committed?: Percents | null;
  base?: Percents | null;
  baseHasChecker?: boolean;
}

const run = ({ current, committed, base, baseHasChecker }: Case) =>
  checkRatchet({
    current,
    committed: committed === null ? null : json(committed ?? current),
    base: base === null || base === undefined ? null : json(base),
    baseHasChecker: baseHasChecker ?? (base !== null && base !== undefined),
  });

describe("checkRatchet", () => {
  test("passes when coverage holds", () => {
    expect(run({ current: all(40), base: all(40) }).errors).toEqual([]);
  });

  test("allows a drop of up to half a point", () => {
    expect(run({ current: all(39.5), committed: all(40), base: all(40) }).errors).toEqual([]);
  });

  test("fails a package that drops more than half a point", () => {
    const current = { ...all(40), api: 39.49 };
    expect(run({ current, committed: all(40), base: all(40) }).errors).toEqual([
      "api: line coverage 39.49% dropped below base 40.00%",
    ]);
  });

  test("fails when the committed baseline is lowered below the base", () => {
    const committed = { ...all(40), api: 30 };
    const { errors } = run({ current: all(40), committed, base: all(40) });
    expect(errors).toEqual(["api: baseline lowered to 30.00% (base has 40.00%)"]);
  });

  test("fails when the committed baseline claims more than is measured", () => {
    const { errors } = run({ current: all(10), committed: all(50), base: null });
    expect(errors).toHaveLength(4);
    expect(errors[0]).toBe("api: baseline claims 50.00% but measured 10.00%");
  });

  test("bootstraps from the committed baseline when the base has none", () => {
    expect(run({ current: all(12), committed: all(12), base: null }).errors).toEqual([]);
  });

  test("fails when the base has the checker but its baseline is missing", () => {
    const { errors } = run({ current: all(1), base: null, baseHasChecker: true });
    expect(errors).toEqual([
      `base has ${CHECKER_PATH} but no ${BASELINE_PATH}; refusing to bootstrap`,
    ]);
  });

  test("fails without a committed baseline", () => {
    expect(run({ current: all(1), committed: null }).errors).toEqual([
      `${BASELINE_PATH} is missing`,
    ]);
  });

  test("fails on a malformed base baseline", () => {
    const result = checkRatchet({
      current: all(1),
      committed: json(all(1)),
      base: "{}",
      baseHasChecker: true,
    });
    expect(result.errors).toEqual([`base ${BASELINE_PATH} is not a valid baseline`]);
  });

  test("fails when a package is missing from the committed baseline", () => {
    const committed = { api: 10, worker: 10, shared: 10 };
    const { errors } = run({ current: all(10), committed, base: null });
    expect(errors).toEqual([`plugins: ${BASELINE_PATH} has no entry`]);
  });

  test("fails when coverage rises half a point above an unraised baseline", () => {
    const current = { ...all(40), shared: 40.5 };
    const { errors } = run({ current, committed: all(40), base: all(40) });
    expect(errors).toEqual([
      "shared: line coverage 40.50% is 0.5 or more above the committed 40.00%; run `bun run check:coverage:update` and commit it",
    ]);
  });

  test("passes once the PR raises the committed baseline with the rise", () => {
    const current = { ...all(40), shared: 45 };
    expect(run({ current, committed: current, base: all(40) }).errors).toEqual([]);
  });

  test("tolerates a rise under half a point without an update", () => {
    const current = { ...all(40), shared: 40.49 };
    expect(run({ current, committed: all(40), base: all(40) }).errors).toEqual([]);
  });
});

describe("updateRefusal", () => {
  test("refuses under CI and allows locally", () => {
    expect(updateRefusal({ CI: "true" })).toContain("local only");
    expect(updateRefusal({})).toBeNull();
  });
});

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

describe("baseline files", () => {
  test("round-trip and reject out-of-range values", () => {
    expect(parseBaseline(json(all(12.345)))).toEqual({ lines: all(12.35) });
    expect(parseBaseline('{"lines":{"api":101}}')).toBeNull();
    expect(parseBaseline("not json")).toBeNull();
  });

  test("an update only ever raises the floor", () => {
    const committed = { lines: { ...all(10), api: 50 } };
    expect(raisedBaseline(all(20), committed)).toEqual({ lines: { ...all(20), api: 50 } });
  });
});

const lcov = (entries: Record<string, [number, number][]>): Coverage =>
  new Map(Object.entries(entries).map(([file, lines]) => [file, new Map(lines)]));

describe("coverage merge", () => {
  test("parses and serializes lcov records", () => {
    const text = "SF:a.ts\nDA:1,2\nDA:3,0\nLF:2\nLH:1\nend_of_record\n";
    const parsed = parseLcov(text);
    expect(parsed.get("a.ts")).toEqual(
      new Map([
        [1, 2],
        [3, 0],
      ]),
    );
    expect(serializeLcov(parsed)).toBe(text);
  });

  test("classifies only package sources", () => {
    expect(packageOf("packages/api/src/routes/jobs.ts")).toBe("api");
    expect(packageOf("packages/api/src/auth.test.ts")).toBeNull();
    expect(packageOf("packages/web/src/app.ts")).toBeNull();
    expect(packageOf("packages/shared/test/helpers/db.ts")).toBeNull();
    expect(packageOf("plugins/slicers/orca/src/index.ts")).toBe("plugins");
    expect(packageOf("plugins/slicers/orca/src/index.test.ts")).toBeNull();
    expect(packageOf("packages/plugins/src/x.ts")).toBeNull();
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

  test("credits only lines bun reports as hit, never a neighbour's count", () => {
    const lines = new Map([
      [2, 0],
      [5, 0],
      [6, 0],
      [10, 0],
    ]);
    const run = new Map([
      [3, 0],
      [5, 4],
      [8, 0],
    ]);
    expect(exactHits(lines, run)).toEqual(
      new Map([
        [2, 0],
        [5, 4],
        [6, 0],
        [10, 0],
      ]),
    );
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
