import { describe, expect, test } from "bun:test";
import { checkRatchet, type Percents, riseIsWarning, serializePercent } from "./ratchet";

const all = (value: number): Percents => ({
  api: value,
  worker: value,
  shared: value,
  plugins: value,
  web: value,
});

const json = (lines: Percents) =>
  Object.fromEntries(Object.entries(lines).map(([name, value]) => [name, serializePercent(value)]));

const onMain = (current: Percents, committed: Percents) =>
  checkRatchet({
    current,
    committed: json(committed),
    base: json(all(40)),
    baseHasChecker: true,
    riseIsWarning: true,
  });

describe("checkRatchet on main", () => {
  test("a rise is a warning, not an error", () => {
    const rose = onMain({ ...all(40), shared: 45 }, all(40));
    expect(rose.errors).toEqual([]);
    expect(rose.warnings).toEqual([
      "shared: line coverage 45.00% is 0.5 or more above the committed 40.00%; run `bun run check:coverage:update` and commit it",
    ]);
  });

  test("a drop or an overclaim still fails", () => {
    const dropped = onMain({ ...all(40), api: 30 }, all(40));
    const overclaimed = onMain(all(40), { ...all(40), web: 41 });
    expect(dropped.errors).toEqual(["api: line coverage 30.00% dropped below base 40.00%"]);
    expect(overclaimed.errors).toEqual(["web: baseline claims 41.00% but measured 40.00%"]);
    expect([...dropped.warnings, ...overclaimed.warnings]).toEqual([]);
  });

  test("off main the same rise is an error", () => {
    const result = checkRatchet({
      current: { ...all(40), shared: 45 },
      committed: json(all(40)),
      base: json(all(40)),
      baseHasChecker: true,
    });
    expect(result.warnings).toEqual([]);
    expect(result.errors).toHaveLength(1);
  });
});

describe("riseIsWarning", () => {
  test("only a run on main that isn't a pull request warns on a rise", () => {
    const main = "refs/heads/main";
    expect(riseIsWarning({ GITHUB_REF: main, GITHUB_EVENT_NAME: "push" })).toBe(true);
    expect(riseIsWarning({ GITHUB_REF: main, GITHUB_EVENT_NAME: "schedule" })).toBe(true);
    expect(riseIsWarning({ GITHUB_REF: main, GITHUB_EVENT_NAME: "pull_request" })).toBe(false);
    const pr = { GITHUB_REF: "refs/pull/558/merge", GITHUB_EVENT_NAME: "pull_request" };
    expect(riseIsWarning(pr)).toBe(false);
    expect(riseIsWarning({ GITHUB_REF: "refs/heads/feature", GITHUB_EVENT_NAME: "push" })).toBe(
      false,
    );
    expect(riseIsWarning({})).toBe(false);
  });
});
