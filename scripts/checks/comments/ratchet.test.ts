import { describe, expect, test } from "bun:test";
import { type Baseline, isBaseline, parseBaseline, serializeBaseline } from "./baseline";
import { BASELINE_PATH, checkRatchet } from "./ratchet";
import type { Tree } from "./tree";

const tree = (files: Record<string, string>): Tree => ({
  list: () => Object.keys(files),
  read: (path) => files[path] ?? null,
});

const baseline = (files: Record<string, [number, number]>): Baseline => ({
  files: Object.fromEntries(
    Object.entries(files).map(([path, [comments, suppressions]]) => [
      path,
      { comments, suppressions },
    ]),
  ),
});

const json = (files: Record<string, [number, number]>) => serializeBaseline(baseline(files));

const baseWith = (files: Record<string, [number, number]>) =>
  tree({ [BASELINE_PATH]: json(files), "scripts/checks/comments.ts": "" });

describe("checkRatchet", () => {
  test("passes when the tree matches its baseline and the base allows it", () => {
    const result = checkRatchet({
      current: baseline({ "a.ts": [2, 0] }),
      committed: json({ "a.ts": [2, 0] }),
      base: baseWith({ "a.ts": [3, 0] }),
    });
    expect(result.errors).toEqual([]);
  });

  test("fails when the committed baseline is missing", () => {
    const result = checkRatchet({ current: baseline({}), committed: null, base: baseWith({}) });
    expect(result.errors).toEqual([`${BASELINE_PATH} is missing`]);
  });

  test("fails when the base has the checker but no baseline", () => {
    const result = checkRatchet({
      current: baseline({}),
      committed: json({}),
      base: tree({ "scripts/checks/comments.ts": "" }),
    });
    expect(result.errors[0]).toContain("no scripts/checks/comments-baseline.json");
  });

  test("bootstraps from the measured base tree before the checker exists", () => {
    const result = checkRatchet({
      current: baseline({ "a.ts": [1, 0] }),
      committed: json({ "a.ts": [1, 0] }),
      base: tree({ "a.ts": "// one\n// two\n" }),
    });
    expect(result.errors).toEqual([]);
  });

  test("compares per file, so moving a comment between files fails", () => {
    const result = checkRatchet({
      current: baseline({ "a.ts": [0, 0], "b.ts": [2, 0] }),
      committed: json({ "a.ts": [0, 0], "b.ts": [2, 0] }),
      base: baseWith({ "a.ts": [1, 0], "b.ts": [1, 0] }),
    });
    expect(result.errors).toContain("added: b.ts: 2 comments (base allows 1)");
  });

  test("fails when the PR raises its own baseline above the base", () => {
    const result = checkRatchet({
      current: baseline({ "a.ts": [1, 0] }),
      committed: json({ "a.ts": [5, 0] }),
      base: baseWith({ "a.ts": [1, 0] }),
    });
    expect(result.errors).toContain("baseline raised: a.ts: 5 comments (base has 1)");
  });

  test("fails on a new suppression even when comment lines stay level", () => {
    const result = checkRatchet({
      current: baseline({ "a.ts": [1, 1] }),
      committed: json({ "a.ts": [1, 1] }),
      base: baseWith({ "a.ts": [1, 0] }),
    });
    expect(result.errors).toContain("added: a.ts: 1 suppressions (base allows 0)");
  });

  test("fails when the baseline is stale after comments were removed", () => {
    const result = checkRatchet({
      current: baseline({ "a.ts": [1, 0] }),
      committed: json({ "a.ts": [2, 0] }),
      base: baseWith({ "a.ts": [2, 0] }),
    });
    expect(result.errors[0]).toContain("is stale");
  });
});

describe("baseline validation", () => {
  test("rejects malformed shapes", () => {
    expect(isBaseline({})).toBe(false);
    expect(isBaseline({ total: "9999" })).toBe(false);
    expect(isBaseline({ files: { "a.ts": { comments: "1", suppressions: 0 } } })).toBe(false);
    expect(isBaseline({ files: { "a.ts": { comments: -1, suppressions: 0 } } })).toBe(false);
    expect(isBaseline({ files: { "a.ts": { comments: 1.5, suppressions: 0 } } })).toBe(false);
    expect(parseBaseline("not json")).toBeNull();
  });

  test("accepts and round-trips a valid baseline", () => {
    const text = json({ "b.ts": [1, 0], "a.ts": [2, 1] });
    expect(parseBaseline(text)).toEqual(baseline({ "a.ts": [2, 1], "b.ts": [1, 0] }));
  });
});
