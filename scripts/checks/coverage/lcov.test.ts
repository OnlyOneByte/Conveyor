import { describe, expect, test } from "bun:test";
import { parseLcov, serializeLcov } from "./lcov";

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
});
