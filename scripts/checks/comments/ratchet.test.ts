import { describe, expect, test } from "bun:test";
import type { Baseline } from "./baseline";
import { checkRatchet, updateRefusal } from "./ratchet";
import type { Tree } from "./tree";

type Counts = Record<string, [number, number]>;

const tree = (files: Record<string, string>): Tree => ({
  list: () => Object.keys(files),
  read: (path) => files[path] ?? null,
});

const baseline = (files: Counts): Baseline => ({
  files: Object.fromEntries(
    Object.entries(files).map(([path, [comments, suppressions]]) => [
      path,
      { comments, suppressions },
    ]),
  ),
});

const source = ([comments, suppressions]: [number, number]) =>
  `${"// @ts-expect-error\n".repeat(suppressions)}${"// note\n".repeat(comments - suppressions)}export {};\n`;

const baseWith = (files: Counts) =>
  tree(Object.fromEntries(Object.entries(files).map(([path, tally]) => [path, source(tally)])));

interface Case {
  current: Counts;
  base: Tree;
  alsoPresent?: string[];
}

const run = ({ current, base, alsoPresent = [] }: Case) =>
  checkRatchet({
    current: baseline(current),
    present: new Set([...Object.keys(current), ...alsoPresent]),
    base,
  }).errors;

describe("checkRatchet", () => {
  test("passes when no file has more than the base has", () => {
    expect(run({ current: { "a.ts": [2, 0] }, base: baseWith({ "a.ts": [3, 0] }) })).toEqual([]);
  });

  test("measures the base's own files, so there is no baseline to update", () => {
    const base = tree({ "a.ts": "// one\n// two\n", "empty.ts": "export {};\n" });
    expect(run({ current: { "a.ts": [1, 0] }, base })).toEqual([]);
    expect(run({ current: { "a.ts": [3, 0] }, base })).toEqual([
      "added: a.ts: 3 comments (base allows 2)",
    ]);
  });

  test("compares per file, so moving a comment between files fails", () => {
    const errors = run({
      current: { "b.ts": [2, 0] },
      base: baseWith({ "a.ts": [1, 0], "b.ts": [1, 0] }),
      alsoPresent: ["a.ts"],
    });
    expect(errors).toContain("added: b.ts: 2 comments (base allows 1)");
  });

  test("fails on a new suppression even when comment lines stay level", () => {
    const errors = run({ current: { "a.ts": [1, 1] }, base: baseWith({ "a.ts": [1, 0] }) });
    expect(errors).toContain("added: a.ts: 1 suppressions (base allows 0)");
  });

  test("adding a commented new file fails, and an empty one passes", () => {
    const base = baseWith({ "a.ts": [1, 0] });
    expect(run({ current: { "a.ts": [1, 0], "new.ts": [1, 0] }, base })).toContain(
      "added: new.ts: 1 comments (base allows 0)",
    );
    expect(run({ current: { "a.ts": [1, 0] }, base, alsoPresent: ["new.ts"] })).toEqual([]);
  });
});

describe("renames", () => {
  test("a deleted file's allowance moves to one new file with the same tally", () => {
    expect(run({ current: { "new.ts": [2, 1] }, base: baseWith({ "old.ts": [2, 1] }) })).toEqual(
      [],
    );
  });

  test("a rename with a different tally gets no allowance", () => {
    const errors = run({ current: { "new.ts": [3, 0] }, base: baseWith({ "old.ts": [2, 0] }) });
    expect(errors).toContain("added: new.ts: 3 comments (base allows 0)");
  });

  test("a file that still exists does not donate its allowance", () => {
    const errors = run({
      current: { "b.ts": [2, 0] },
      base: baseWith({ "a.ts": [2, 0] }),
      alsoPresent: ["a.ts"],
    });
    expect(errors).toContain("added: b.ts: 2 comments (base allows 0)");
  });

  test("two new files cannot both claim one deleted file's allowance", () => {
    const errors = run({
      current: { "c.ts": [2, 0], "d.ts": [2, 0] },
      base: baseWith({ "a.ts": [2, 0] }),
    });
    expect(errors).toEqual(["added: d.ts: 2 comments (base allows 0)"]);
  });
});

describe("updateRefusal", () => {
  test("refuses under CI and allows locally", () => {
    expect(updateRefusal({ CI: "true" })).toBe(
      "--update is local only; commit the regenerated baseline instead",
    );
    expect(updateRefusal({ CI: "1" })).not.toBeNull();
    expect(updateRefusal({})).toBeNull();
  });

  test("an empty CI value counts as not CI, matching the coverage checker", () => {
    expect(updateRefusal({ CI: "" })).toBeNull();
  });
});
