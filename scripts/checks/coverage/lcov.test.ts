import { describe, expect, test } from "bun:test";
import { exactHits, parseLcov, serializeLcov } from "./lcov";

describe("lcov", () => {
  test("parses and serializes lcov records", () => {
    const text = "SF:a.ts\nDA:1,2\nDA:3,0\nLF:2\nLH:1\nend_of_record\n";
    const parsed = parseLcov(text);
    expect(parsed.get("a.ts")).toEqual(
      new Map([
        [1, 2],
        [3, 0],
      ]),
    );
    expect(serializeLcov(parsed)).toBe(text);
  });

  test("credits only lines bun reports as hit, never a neighbour's count", () => {
    const lines = new Map([
      [2, 0],
      [5, 0],
      [6, 0],
      [10, 0],
    ]);
    const run = new Map([
      [3, 0],
      [5, 4],
      [8, 0],
    ]);
    expect(exactHits(lines, run)).toEqual(
      new Map([
        [2, 0],
        [5, 4],
        [6, 0],
        [10, 0],
      ]),
    );
  });
});
