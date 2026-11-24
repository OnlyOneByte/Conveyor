import { describe, expect, test } from "bun:test";
import type { Tree } from "../comments/tree";
import { serializeBaseline } from "../lines/baseline";
import type { Counts } from "../lines/count";
import { countCasts, measure } from "./count";
import { BASELINE_PATH, CHECKER_PATH, checkRatchet, type Pair, parsePairs } from "./ratchet";

const treeOf = (files: Record<string, string>): Tree => ({
  list: () => Object.keys(files),
  read: (path) => files[path] ?? null,
});

const cast = "const n = value as number;\n";

const baseWith = (files: Record<string, string>, baseline: Counts) =>
  treeOf({ ...files, [CHECKER_PATH]: "", [BASELINE_PATH]: serializeBaseline(baseline) });

interface Change {
  committed?: Counts;
  present?: string[];
  pairs?: Pair[];
}

const run = (current: Counts, base: Tree, change: Change = {}) =>
  checkRatchet({
    current,
    base,
    committed: serializeBaseline(change.committed ?? current),
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
  const base = baseWith({ "a.ts": cast }, { "a.ts": 1 });

  test("passes when the tree matches the base's baseline", () => {
    expect(run({ "a.ts": 1 }, base)).toEqual([]);
  });

  test("fails on a new cast in a new file", () => {
    expect(run({ "a.ts": 1, "b.ts": 1 }, base)[0]).toContain("new cast: b.ts: 1");
  });

  test("fails on a second cast in a baselined file, even with the baseline raised", () => {
    const errors = run({ "a.ts": 2 }, base);
    expect(errors).toEqual([
      expect.stringContaining("new cast: a.ts: 2"),
      expect.stringContaining("baseline raised: a.ts: 2"),
    ]);
  });

  test("a removed cast must lower the baseline", () => {
    const present = ["a.ts"];
    expect(run({}, base, { committed: { "a.ts": 1 }, present })[0]).toContain("is stale");
    expect(run({}, base, { committed: {}, present })).toEqual([]);
  });

  test("a missing or invalid committed baseline fails", () => {
    const change = { present: new Set<string>(), pairs: [] };
    expect(checkRatchet({ current: {}, base, committed: null, ...change })[0]).toContain(
      "is missing",
    );
    expect(checkRatchet({ current: {}, base, committed: "[]", ...change })[0]).toContain(
      "not a valid",
    );
  });

  test("a file git pairs as a rename keeps its allowance", () => {
    expect(run({ "b.ts": 1 }, base, { pairs: moved("a.ts", "b.ts") })).toEqual([]);
  });

  test("a file git pairs as the halves of a split shares its allowance, capped", () => {
    const big = baseWith({ "a.ts": cast.repeat(3) }, { "a.ts": 3 });
    const pairs = moved("a.ts", "b.ts", "c.ts");
    expect(run({ "b.ts": 2, "c.ts": 1 }, big, { pairs })).toEqual([]);
    expect(run({ "b.ts": 2, "c.ts": 2 }, big, { pairs })[0]).toContain("new cast: c.ts: 2");
  });

  test("a removed file's allowance does not move to an unrelated new file", () => {
    const big = baseWith({ "a.ts": cast.repeat(8) }, { "a.ts": 8 });
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
    const two = baseWith({ "a.ts": cast, "b.ts": "" }, { "a.ts": 1 });
    expect(run({ "b.ts": 1 }, two, { pairs: moved("a.ts", "b.ts") })[0]).toContain(
      "new cast: b.ts: 1",
    );
  });

  test("reads rename and copy pairs from git diff -z --name-status", () => {
    const out = ["M", "x.ts", "R087", "a.ts", "b.ts", "C066", "a.ts", "c.ts", "A", "d.ts", ""];
    expect(parsePairs(out.join("\0"))).toEqual(moved("a.ts", "b.ts", "c.ts"));
    expect(parsePairs("")).toEqual([]);
  });

  test("a base without the checker allows exactly the casts it already has", () => {
    const before = treeOf({ "a.ts": cast + cast });
    expect(run({ "a.ts": 2 }, before)).toEqual([]);
    expect(run({ "a.ts": 3 }, before)[0]).toContain("new cast: a.ts: 3");
  });

  test("a base with the checker but no baseline fails closed", () => {
    expect(run({}, treeOf({ [CHECKER_PATH]: "" }))[0]).toContain(
      "no scripts/checks/casts/baseline.json",
    );
  });
});
