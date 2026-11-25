import { describe, expect, test } from "bun:test";
import type { Tree } from "../comments/tree";
import { type Counts, countLines, measure, overLimit } from "./count";
import { checkRatchet } from "./ratchet";

const treeOf = (files: Record<string, string>): Tree => ({
  list: () => Object.keys(files),
  read: (path) => files[path] ?? null,
});

const lines = (n: number) => "x\n".repeat(n);

const baseOf = (counts: Counts) =>
  treeOf(Object.fromEntries(Object.entries(counts).map(([path, n]) => [path, lines(n)])));

const run = (current: Counts, base: Tree) => checkRatchet({ current, base }).errors;

describe("counting lines", () => {
  test("counts a last line with or without a trailing newline", () => {
    expect(countLines("")).toBe(0);
    expect(countLines("a")).toBe(1);
    expect(countLines("a\n")).toBe(1);
    expect(countLines("a\nb")).toBe(2);
    expect(countLines("a\n\n")).toBe(2);
  });

  test("counts CR and CRLF line endings like LF", () => {
    expect(countLines("a\rb")).toBe(2);
    expect(countLines("a\rb\r")).toBe(2);
    expect(countLines("a\r\nb\r\n")).toBe(2);
    expect(countLines("x\r".repeat(400))).toBe(400);
    expect(countLines("a\r\rb")).toBe(3);
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
    const base = baseOf({});
    expect(run({ "a.ts": 250, "b.svelte": 150 }, base)).toEqual([]);
    expect(run({ "a.ts": 251 }, base)).toEqual(["too long: a.ts: 251 lines (limit 250)"]);
    expect(run({ "b.svelte": 151 }, base)).toEqual(["too long: b.svelte: 151 lines (limit 150)"]);
  });

  test("a file over the limit on the base may keep its length and no more", () => {
    const base = baseOf({ "big.ts": 400 });
    expect(run({ "big.ts": 400 }, base)).toEqual([]);
    expect(run({ "big.ts": 380 }, base)).toEqual([]);
    expect(run({ "big.ts": 401 }, base)).toEqual(["too long: big.ts: 401 lines (base allows 400)"]);
  });

  test("a file the base had under the limit may grow to the limit, not past it", () => {
    const base = baseOf({ "ok.ts": 200 });
    expect(run({ "ok.ts": 250 }, base)).toEqual([]);
    expect(run({ "ok.ts": 251 }, base)).toEqual(["too long: ok.ts: 251 lines (limit 250)"]);
  });

  test("a shrink on the base is the new ceiling, with nothing to update", () => {
    const shrunk = baseOf({ "big.ts": 300 });
    expect(run({ "big.ts": 300 }, shrunk)).toEqual([]);
    expect(run({ "big.ts": 320 }, shrunk)).toEqual([
      "too long: big.ts: 320 lines (base allows 300)",
    ]);
  });

  test("a renamed long file is new, so it must keep to the limit", () => {
    const base = baseOf({ "old.ts": 400 });
    expect(run({ "new.ts": 400 }, base)).toEqual(["too long: new.ts: 400 lines (limit 250)"]);
  });
});
