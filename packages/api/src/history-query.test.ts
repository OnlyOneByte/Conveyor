import { describe, expect, test } from "bun:test";
import { historyPageQuery } from "./history-query";

const limitOf = (limit?: string) => historyPageQuery.parse({ limit }).limit;

describe("the history page query", () => {
  test.each([
    [undefined, 50],
    ["7", 7],
    ["200", 200],
    ["500", 200],
    ["0", 50],
    ["-5", 50],
    ["1.5", 50],
    ["abc", 50],
  ])("reads limit %p as %p", (limit, expected) => {
    expect(limitOf(limit)).toBe(expected);
  });

  test("reads a cursor whose id contains a colon", () => {
    expect(historyPageQuery.parse({ before: "3000:a:b" }).before).toEqual({
      updatedAt: 3000,
      id: "a:b",
    });
  });
});
