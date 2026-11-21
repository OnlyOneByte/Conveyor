import { describe, expect, test } from "bun:test";
import { type Coverage, parseLcov, projectHits, serializeLcov } from "./lcov";
import {
  BASELINE_PATH,
  checkRatchet,
  type Percents,
  parseBaseline,
  raisedBaseline,
  serializeBaseline,
} from "./ratchet";
import { mergeCoverage, nonBlankLines, packageOf, percents, summarize } from "./summary";

const json = (lines: Percents) => serializeBaseline({ lines });

const all = (value: number): Percents => ({ api: value, worker: value, shared: value });

interface Case {
  current: Percents;
  committed?: Percents | null;
  base?: Percents | null;
}

const run = ({ current, committed, base }: Case) =>
  checkRatchet({
    current,
    committed: committed === null ? null : json(committed ?? current),
    base: base === null || base === undefined ? null : json(base),
  });

describe("checkRatchet", () => {
  test("passes when coverage holds", () => {
    expect(run({ current: all(40), base: all(40) }).errors).toEqual([]);
  });

  test("allows a drop of up to half a point", () => {
    expect(run({ current: all(39.5), committed: all(40), base: all(40) }).errors).toEqual([]);
  });

  test("fails a package that drops more than half a point", () => {
    const current = { api: 39.49, worker: 40, shared: 40 };
    expect(run({ current, committed: all(40), base: all(40) }).errors).toEqual([
      "api: line coverage 39.49% dropped below base 40.00%",
    ]);
  });

  test("fails when the committed baseline is lowered below the base", () => {
    const committed = { api: 30, worker: 40, shared: 40 };
    const { errors } = run({ current: all(40), committed, base: all(40) });
    expect(errors).toEqual(["api: baseline lowered to 30.00% (base has 40.00%)"]);
  });

  test("fails when the committed baseline claims more than is measured", () => {
    const { errors } = run({ current: all(10), committed: all(50), base: null });
    expect(errors).toHaveLength(3);
    expect(errors[0]).toBe("api: baseline claims 50.00% but measured 10.00%");
  });

  test("bootstraps from the committed baseline when the base has none", () => {
    expect(run({ current: all(12), committed: all(12), base: null }).errors).toEqual([]);
  });

  test("fails without a committed baseline", () => {
    expect(run({ current: all(1), committed: null }).errors).toEqual([
      `${BASELINE_PATH} is missing`,
    ]);
  });

  test("fails on a malformed base baseline", () => {
    const result = checkRatchet({ current: all(1), committed: json(all(1)), base: "{}" });
    expect(result.errors).toEqual([`base ${BASELINE_PATH} is not a valid baseline`]);
  });

  test("fails when a package is missing from the committed baseline", () => {
    const committed = { api: 10, worker: 10 };
    const { errors } = run({ current: all(10), committed, base: null });
    expect(errors).toEqual([`shared: ${BASELINE_PATH} has no entry`]);
  });

  test("suggests an update once coverage rises a full point", () => {
    const { errors, notices } = run({ current: all(42), committed: all(40), base: all(40) });
    expect(errors).toEqual([]);
    expect(notices).toHaveLength(3);
  });
});

describe("baseline files", () => {
  test("round-trip and reject out-of-range values", () => {
    expect(parseBaseline(json(all(12.345)))).toEqual({ lines: all(12.35) });
    expect(parseBaseline('{"lines":{"api":101}}')).toBeNull();
    expect(parseBaseline("not json")).toBeNull();
  });

  test("an update only ever raises the floor", () => {
    const committed = { lines: { api: 50, worker: 10, shared: 10 } };
    expect(raisedBaseline(all(20), committed)).toEqual({
      lines: { api: 50, worker: 20, shared: 20 },
    });
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
    expect(percents(summary)).toEqual({ api: 0, worker: 0, shared: 100 });
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
        [2, 3],
        [3, 0],
        [4, 0],
      ]),
    );
    expect(after.api).toEqual({ found: 6, hit: 2 });
  });

  test("projects run hits onto the stable lines from the nearest mark above", () => {
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
    expect(projectHits(lines, run)).toEqual(
      new Map([
        [2, 0],
        [5, 4],
        [6, 4],
        [10, 0],
      ]),
    );
  });
});
