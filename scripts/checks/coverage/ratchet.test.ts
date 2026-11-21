import { describe, expect, test } from "bun:test";
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

  test("fails a baseline lowered by a hundredth of a point", () => {
    const committed = { ...all(40), api: 39.99 };
    const { errors } = run({ current: all(40), committed, base: all(40) });
    expect(errors).toEqual(["api: baseline lowered to 39.99% (base has 40.00%)"]);
  });

  test("allows a claim up to half a point above measured, not beyond", () => {
    const base = all(40);
    const atLimit = run({ current: all(40), committed: { ...all(40), api: 40.5 }, base });
    const over = run({ current: all(40), committed: { ...all(40), api: 40.51 }, base });
    expect(atLimit.errors).toEqual([]);
    expect(over.errors).toEqual(["api: baseline claims 40.51% but measured 40.00%"]);
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
