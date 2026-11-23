import { describe, expect, test } from "bun:test";
import type { Tree } from "../comments/tree";
import { BASELINE_PATH, parseBaseline, serializeBaseline } from "./baseline";
import { type Counts, countLines, measure, overLimit } from "./count";
import { CHECKER_PATH, checkRatchet } from "./ratchet";

const treeOf = (files: Record<string, string>): Tree => ({
  list: () => Object.keys(files),
  read: (path) => files[path] ?? null,
});

const lines = (n: number) => "x\n".repeat(n);

const baseWith = (files: Record<string, string>, baseline?: Counts) =>
  treeOf({
    ...files,
    [CHECKER_PATH]: "",
    ...(baseline ? { [BASELINE_PATH]: serializeBaseline(baseline) } : {}),
  });

const run = (current: Counts, base: Tree, committed: Counts | string | null = overLimit(current)) =>
  checkRatchet({
    current,
    base,
    committed:
      typeof committed === "object" && committed !== null
        ? serializeBaseline(committed)
        : committed,
  }).errors;

describe("counting lines", () => {
  test("counts a last line with or without a trailing newline", () => {
    expect(countLines("")).toBe(0);
    expect(countLines("a")).toBe(1);
    expect(countLines("a\n")).toBe(1);
    expect(countLines("a\nb")).toBe(2);
    expect(countLines("a\n\n")).toBe(2);
  });

  test("measures code, styles and components, not docs, config or data", () => {
    const tree = treeOf({
      "a.ts": lines(3),
      "b.svelte": lines(2),
      "c.css": lines(1),
      "d.mjs": lines(4),
      "README.md": lines(900),
      ".github/workflows/ci.yml": lines(900),
      "bun.lock": lines(900),
      "e.json": lines(900),
    });
    expect(measure(tree)).toEqual({ "a.ts": 3, "b.svelte": 2, "c.css": 1, "d.mjs": 4 });
  });

  test("lists only files over their limit: 250 lines, or 150 for a component", () => {
    const counts = { "a.ts": 250, "b.ts": 251, "c.svelte": 150, "d.svelte": 151, "e.css": 251 };
    expect(overLimit(counts)).toEqual({ "b.ts": 251, "d.svelte": 151, "e.css": 251 });
  });
});

describe("the line ratchet", () => {
  test("a new file passes at the limit and fails one line over it", () => {
    const base = baseWith({}, {});
    expect(run({ "a.ts": 250, "b.svelte": 150 }, base)).toEqual([]);
    expect(run({ "a.ts": 251 }, base, {})).toEqual(["too long: a.ts: 251 lines (limit 250)"]);
    expect(run({ "b.svelte": 151 }, base, {})).toEqual([
      "too long: b.svelte: 151 lines (limit 150)",
    ]);
  });

  test("a file in the base baseline may grow up to its entry and no further", () => {
    const base = baseWith({}, { "big.ts": 400 });
    expect(run({ "big.ts": 400 }, base)).toEqual([]);
    expect(run({ "big.ts": 401 }, base, { "big.ts": 400 })).toEqual([
      "too long: big.ts: 401 lines (base allows 400)",
    ]);
  });

  test("raising an entry, or adding one the base lacks, is refused", () => {
    const base = baseWith({}, { "big.ts": 400 });
    expect(run({ "big.ts": 401 }, base)).toEqual([
      "too long: big.ts: 401 lines (base allows 400)",
      "baseline raised: big.ts: 401 lines (base allows 400)",
    ]);
    expect(run({ "new.ts": 300 }, base)).toEqual([
      "too long: new.ts: 300 lines (limit 250)",
      "baseline raised: new.ts: 300 lines (limit 250)",
    ]);
  });

  test("a baselined file that shrinks makes the baseline stale until it shrinks too", () => {
    const base = baseWith({}, { "big.ts": 400, "page.svelte": 300 });
    const stale = `${BASELINE_PATH} is stale; run \`bun run check:lines:update\` and commit it`;
    const current = { "big.ts": 380, "page.svelte": 120 };
    expect(run(current, base, { "big.ts": 400, "page.svelte": 300 })).toEqual([stale]);
    expect(run(current, base, { "big.ts": 380, "page.svelte": 300 })).toEqual([stale]);
    expect(run(current, base, { "big.ts": 380 })).toEqual([]);
  });

  test("a base without the checker allows what it already has, so the first baseline passes", () => {
    const base = treeOf({ "big.ts": lines(400), "ok.ts": lines(10), "README.md": lines(900) });
    expect(run({ "big.ts": 400, "ok.ts": 10 }, base)).toEqual([]);
    expect(run({ "big.ts": 401 }, base, { "big.ts": 400 })).toEqual([
      "too long: big.ts: 401 lines (base allows 400)",
    ]);
  });

  test("a base with the checker but no baseline is an error, not an empty allowance", () => {
    const base = treeOf({ [CHECKER_PATH]: "", "big.ts": lines(400) });
    expect(run({ "big.ts": 400 }, base)).toEqual([`base has the checker but no ${BASELINE_PATH}`]);
  });

  test("a missing or malformed baseline is an error", () => {
    const base = baseWith({}, {});
    expect(run({}, base, null)).toEqual([`${BASELINE_PATH} is missing`]);
    for (const text of [
      "{",
      "[]",
      '{"files":[]}',
      '{"files":{"a.ts":-1}}',
      '{"files":{"a.ts":1.5}}',
    ]) {
      expect(run({}, base, text)).toEqual([`${BASELINE_PATH} is not a valid baseline`]);
    }
    const broken = treeOf({ [CHECKER_PATH]: "", [BASELINE_PATH]: '{"files":{"a.ts":"x"}}' });
    expect(run({}, broken)).toEqual([`base ${BASELINE_PATH} is not a valid baseline`]);
  });

  test("the baseline is written sorted, so a stale check compares text", () => {
    const text = serializeBaseline({ "b.ts": 300, "a.ts": 260 });
    expect(text).toBe('{\n  "files": {\n    "a.ts": 260,\n    "b.ts": 300\n  }\n}\n');
    expect(parseBaseline(text)).toEqual({ "a.ts": 260, "b.ts": 300 });
  });
});
