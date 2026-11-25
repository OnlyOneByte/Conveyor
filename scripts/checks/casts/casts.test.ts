import { describe, expect, test } from "bun:test";
import type { Tree } from "../comments/tree";
import type { Counts } from "../lines/count";
import { countCasts, measure } from "./count";
import { checkRatchet, type Pair, parsePairs } from "./ratchet";

const treeOf = (files: Record<string, string>): Tree => ({
  list: () => Object.keys(files),
  read: (path) => files[path] ?? null,
});

const cast = "const n = value as number;\n";

interface Change {
  present?: string[];
  pairs?: Pair[];
}

const run = (current: Counts, base: Tree, change: Change = {}) =>
  checkRatchet({
    current,
    base,
    present: new Set(change.present ?? Object.keys(current)),
    pairs: change.pairs ?? [],
  });

const moved = (from: string, ...to: string[]): Pair[] => to.map((path) => ({ from, to: path }));

describe("counting casts", () => {
  test("counts `as` and angle-bracket assertions but not const assertions", () => {
    const src = [
      "const a = x as string;",
      "const b = <number>y;",
      'const c = ["a", "b"] as const;',
      'const f = <const>["a", "b"];',
      "const d = z as unknown as Date;",
      "const e = { k: 1 } satisfies Record<string, number>;",
    ].join("\n");
    expect(countCasts("a.ts", src)).toBe(4);
  });

  test("reads every script block of a Svelte file and skips its markup", () => {
    const src = [
      '<script module lang="ts">export const k = v as string;</script>',
      '<script lang="ts">let n = m as number; const keys = ["x"] as const;</script>',
      "<p>Cast it as a string, as you like</p>",
    ].join("\n");
    expect(countCasts("C.svelte", src)).toBe(2);
  });

  test("parses TSX, where angle-bracket assertions are JSX", () => {
    expect(countCasts("v.tsx", "const el = <div>{x as string}</div>;")).toBe(1);
  });

  test("measures only TypeScript and Svelte files with at least one cast", () => {
    const tree = treeOf({ "a.ts": cast, "b.ts": "const k = 1;\n", "c.js": cast, "d.svelte": "" });
    expect(measure(tree)).toEqual({ "a.ts": 1 });
  });
});

describe("the cast ratchet", () => {
  const base = treeOf({ "a.ts": cast });

  test("passes when the tree keeps the base's casts", () => {
    expect(run({ "a.ts": 1 }, base)).toEqual([]);
  });

  test("fails on a new cast in a new file", () => {
    expect(run({ "a.ts": 1, "b.ts": 1 }, base)[0]).toContain("new cast: b.ts: 1");
  });

  test("fails on a second cast in a file the base has one in", () => {
    expect(run({ "a.ts": 2 }, base)).toEqual([expect.stringContaining("new cast: a.ts: 2")]);
  });

  test("a removed cast needs no update, and the base it lands on allows no more", () => {
    expect(run({}, base, { present: ["a.ts"] })).toEqual([]);
    const after = treeOf({ "a.ts": "const k = 1;\n" });
    expect(run({ "a.ts": 1 }, after)[0]).toContain("new cast: a.ts: 1 `as` casts (base allows 0)");
  });

  test("a file git pairs as a rename keeps its allowance", () => {
    expect(run({ "b.ts": 1 }, base, { pairs: moved("a.ts", "b.ts") })).toEqual([]);
  });

  test("a file git pairs as the halves of a split shares its allowance, capped", () => {
    const big = treeOf({ "a.ts": cast.repeat(3) });
    const pairs = moved("a.ts", "b.ts", "c.ts");
    expect(run({ "b.ts": 2, "c.ts": 1 }, big, { pairs })).toEqual([]);
    expect(run({ "b.ts": 2, "c.ts": 2 }, big, { pairs })[0]).toContain("new cast: c.ts: 2");
  });

  test("a removed file's allowance does not move to an unrelated new file", () => {
    const big = treeOf({ "a.ts": cast.repeat(8) });
    expect(run({ "laundered.ts": 8 }, big)[0]).toContain("new cast: laundered.ts: 8");
    const other = moved("elsewhere.ts", "laundered.ts");
    expect(run({ "laundered.ts": 8 }, big, { pairs: other })[0]).toContain("new cast");
  });

  test("a file still in the tree gives nothing, even with no casts left", () => {
    const pairs = moved("a.ts", "b.ts");
    expect(run({ "b.ts": 1 }, base, { present: ["a.ts", "b.ts"], pairs })[0]).toContain(
      "new cast: b.ts: 1",
    );
  });

  test("a removed file's allowance does not move to a file the base already has", () => {
    const two = treeOf({ "a.ts": cast, "b.ts": "" });
    expect(run({ "b.ts": 1 }, two, { pairs: moved("a.ts", "b.ts") })[0]).toContain(
      "new cast: b.ts: 1",
    );
  });

  test("reads rename and copy pairs from git diff -z --name-status", () => {
    const out = ["M", "x.ts", "R087", "a.ts", "b.ts", "C066", "a.ts", "c.ts", "A", "d.ts", ""];
    expect(parsePairs(out.join("\0"))).toEqual(moved("a.ts", "b.ts", "c.ts"));
    expect(parsePairs("")).toEqual([]);
  });

  test("the allowance is what the base has, file by file", () => {
    const before = treeOf({ "a.ts": cast + cast, "b.ts": cast });
    expect(run({ "a.ts": 2, "b.ts": 1 }, before)).toEqual([]);
    expect(run({ "a.ts": 3, "b.ts": 0 }, before)[0]).toContain("new cast: a.ts: 3");
  });
});
