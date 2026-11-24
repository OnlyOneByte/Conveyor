import { describe, expect, test } from "bun:test";
import type { Tree } from "../comments/tree";
import { serializeBaseline } from "../lines/baseline";
import type { Counts } from "../lines/count";
import { countCasts, measure } from "./count";
import { BASELINE_PATH, CHECKER_PATH, checkRatchet } from "./ratchet";

const treeOf = (files: Record<string, string>): Tree => ({
  list: () => Object.keys(files),
  read: (path) => files[path] ?? null,
});

const cast = "const n = value as number;\n";

const baseWith = (files: Record<string, string>, baseline: Counts) =>
  treeOf({ ...files, [CHECKER_PATH]: "", [BASELINE_PATH]: serializeBaseline(baseline) });

const run = (current: Counts, base: Tree, committed: Counts = current) =>
  checkRatchet({ current, base, committed: serializeBaseline(committed) });

describe("counting casts", () => {
  test("counts `as` and angle-bracket assertions but not `as const`", () => {
    const src = [
      "const a = x as string;",
      "const b = <number>y;",
      'const c = ["a", "b"] as const;',
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
    expect(run({}, base, { "a.ts": 1 })[0]).toContain("is stale");
    expect(run({}, base, {})).toEqual([]);
  });

  test("a missing or invalid committed baseline fails", () => {
    expect(checkRatchet({ current: {}, base, committed: null })[0]).toContain("is missing");
    expect(checkRatchet({ current: {}, base, committed: "[]" })[0]).toContain("not a valid");
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
