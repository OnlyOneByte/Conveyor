import { describe, expect, test } from "bun:test";
import { ratchetInput } from "./main";
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
  const main = "refs/heads/main";

  test("a push, the schedule or a manual run on main warns on a rise", () => {
    for (const event of ["push", "schedule", "workflow_dispatch"]) {
      expect(riseIsWarning({ GITHUB_REF: main, GITHUB_EVENT_NAME: event })).toBe(true);
    }
  });

  test("any other event fails on a rise, even with GITHUB_REF on main", () => {
    for (const event of [
      "pull_request",
      "pull_request_target",
      "workflow_run",
      "merge_group",
      "repository_dispatch",
      "",
    ]) {
      expect(riseIsWarning({ GITHUB_REF: main, GITHUB_EVENT_NAME: event })).toBe(false);
    }
    expect(riseIsWarning({ GITHUB_REF: main })).toBe(false);
  });

  test("a run off main fails on a rise", () => {
    const pr = { GITHUB_REF: "refs/pull/558/merge", GITHUB_EVENT_NAME: "pull_request" };
    expect(riseIsWarning(pr)).toBe(false);
    for (const ref of ["refs/heads/feature", "refs/heads/main-old", "refs/tags/v1"]) {
      expect(riseIsWarning({ GITHUB_REF: ref, GITHUB_EVENT_NAME: "push" })).toBe(false);
    }
    expect(riseIsWarning({})).toBe(false);
  });
});

describe("ratchetInput", () => {
  const summary = {
    api: { hit: 1, found: 1 },
    worker: { hit: 1, found: 1 },
    shared: { hit: 1, found: 1 },
    plugins: { hit: 1, found: 1 },
    web: { hit: 1, found: 1 },
  };
  const base = { baseline: json(all(40)), hasChecker: true, packages: null };

  test("passes the main-run flag the checker reads from the environment", () => {
    const push = { GITHUB_REF: "refs/heads/main", GITHUB_EVENT_NAME: "push" };
    const pr = { GITHUB_REF: "refs/pull/1/merge", GITHUB_EVENT_NAME: "pull_request" };
    expect(
      ratchetInput({ summary, committed: json(all(40)), base, floors: {}, env: push })
        .riseIsWarning,
    ).toBe(true);
    expect(
      ratchetInput({ summary, committed: json(all(40)), base, floors: {}, env: pr }).riseIsWarning,
    ).toBe(false);
  });

  test("on a main push a rise warns end to end, and on a pull request it fails", () => {
    const push = { GITHUB_REF: "refs/heads/main", GITHUB_EVENT_NAME: "push" };
    const pr = { GITHUB_REF: "refs/pull/1/merge", GITHUB_EVENT_NAME: "pull_request" };
    const onPush = checkRatchet(
      ratchetInput({ summary, committed: json(all(40)), base, floors: {}, env: push }),
    );
    const onPr = checkRatchet(
      ratchetInput({ summary, committed: json(all(40)), base, floors: {}, env: pr }),
    );
    expect(onPush.errors).toEqual([]);
    expect(onPush.warnings).toHaveLength(5);
    expect(onPr.errors).toHaveLength(5);
    expect(onPr.warnings).toEqual([]);
  });
});
