import { describe, expect, test } from "bun:test";
import { BASELINE_DIR, readAreas, serializeAreas } from "./areas";
import { type Baseline, isBaseline, parseBaseline, serializeBaseline } from "./baseline";
import { checkRatchet } from "./ratchet";
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

const json = (files: Counts) => serializeBaseline(baseline(files));

const areaFiles = (files: Counts) => Object.fromEntries(serializeAreas(baseline(files)));

const baseWith = (files: Counts) => tree({ ...areaFiles(files), "scripts/checks/comments.ts": "" });

interface Case {
  current: Counts;
  committed?: Counts | null;
  base: Tree;
  alsoPresent?: string[];
}

const run = ({ current, committed, base, alsoPresent = [] }: Case) =>
  checkRatchet({
    current: baseline(current),
    present: new Set([...Object.keys(current), ...alsoPresent]),
    committed: committed === null ? {} : readAreas(tree(areaFiles(committed ?? current))),
    base,
  }).errors;

describe("checkRatchet", () => {
  test("passes when the tree matches its baseline and the base allows it", () => {
    expect(run({ current: { "a.ts": [2, 0] }, base: baseWith({ "a.ts": [3, 0] }) })).toEqual([]);
  });

  test("fails when the committed baseline is missing", () => {
    expect(run({ current: {}, committed: null, base: baseWith({}) })).toEqual([
      `${BASELINE_DIR}/ is missing`,
    ]);
  });

  test("fails when the base has the checker but no baseline", () => {
    const errors = run({ current: {}, base: tree({ "scripts/checks/comments.ts": "" }) });
    expect(errors).toEqual(["base has the checker but no scripts/checks/comments/baseline/"]);
  });

  test("bootstraps from the measured base tree before the checker exists", () => {
    const base = tree({ "a.ts": "// one\n// two\n", "empty.ts": "export {};\n" });
    expect(run({ current: { "a.ts": [1, 0] }, base })).toEqual([]);
  });

  test("compares per file, so moving a comment between files fails", () => {
    const errors = run({
      current: { "b.ts": [2, 0] },
      base: baseWith({ "a.ts": [1, 0], "b.ts": [1, 0] }),
      alsoPresent: ["a.ts"],
    });
    expect(errors).toContain("added: b.ts: 2 comments (base allows 1)");
  });

  test("fails when the PR raises its own baseline above the base", () => {
    const errors = run({
      current: { "a.ts": [1, 0] },
      committed: { "a.ts": [5, 0] },
      base: baseWith({ "a.ts": [1, 0] }),
    });
    expect(errors).toContain("baseline raised: a.ts: 5 comments (base has 1)");
  });

  test("fails on a new suppression even when comment lines stay level", () => {
    const errors = run({ current: { "a.ts": [1, 1] }, base: baseWith({ "a.ts": [1, 0] }) });
    expect(errors).toContain("added: a.ts: 1 suppressions (base allows 0)");
  });

  test("fails when the baseline is stale after comments were removed", () => {
    const errors = run({
      current: { "a.ts": [1, 0] },
      committed: { "a.ts": [2, 0] },
      base: baseWith({ "a.ts": [2, 0] }),
    });
    expect(errors[0]).toContain("is stale");
  });
});

describe("comment-free files never touch the baseline", () => {
  test("adding an empty new file passes with the base's baseline unchanged", () => {
    const errors = run({
      current: { "a.ts": [1, 0] },
      committed: { "a.ts": [1, 0] },
      base: baseWith({ "a.ts": [1, 0] }),
      alsoPresent: ["new.ts"],
    });
    expect(errors).toEqual([]);
  });

  test("deleting a comment-free file passes with the baseline unchanged", () => {
    expect(run({ current: { "a.ts": [1, 0] }, base: baseWith({ "a.ts": [1, 0] }) })).toEqual([]);
  });

  test("adding a commented new file fails", () => {
    const errors = run({
      current: { "a.ts": [1, 0], "new.ts": [1, 0] },
      base: baseWith({ "a.ts": [1, 0] }),
    });
    expect(errors).toContain("added: new.ts: 1 comments (base allows 0)");
  });

  test("zero entries in a committed baseline are ignored, never stored", () => {
    expect(json({ "a.ts": [0, 0], "b.ts": [1, 0] })).toBe(json({ "b.ts": [1, 0] }));
    const errors = run({
      current: { "b.ts": [1, 0] },
      committed: { "a.ts": [0, 0], "b.ts": [1, 0] },
      base: baseWith({ "b.ts": [1, 0] }),
    });
    expect(errors).toEqual([]);
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
    expect(errors).toEqual([
      "added: d.ts: 2 comments (base allows 0)",
      "baseline raised: d.ts: 2 comments (base has 0)",
    ]);
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
