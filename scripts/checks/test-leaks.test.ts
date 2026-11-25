import { describe, expect, test } from "bun:test";
import { leakErrors } from "./test-leaks";

describe("leakErrors", () => {
  test("passes when no conveyor- entry and no Redis key is left", () => {
    expect(leakErrors("/tmp", ["bun-cache", "other-dir"], [])).toEqual([]);
    expect(leakErrors("/tmp", [], null)).toEqual([]);
  });

  test("names each conveyor- entry the tests left, sorted", () => {
    expect(leakErrors("/tmp", ["conveyor-pipeline-b2", "x", "conveyor-elegoo-a1"], [])).toEqual([
      "the tests left 2 conveyor-* entries in /tmp: conveyor-elegoo-a1, conveyor-pipeline-b2",
    ]);
  });

  test("names the Redis keys left, and caps a long list", () => {
    const keys = Array.from({ length: 12 }, (_, i) => `job:${String(i).padStart(2, "0")}:seq`);
    expect(leakErrors("/tmp", [], ["jobs:active"])).toEqual([
      "the tests left 1 Redis keys: jobs:active",
    ]);
    expect(leakErrors("/tmp", [], keys)[0]).toEndWith("job:09:seq, and 2 more");
  });

  test("reports temp entries and Redis keys together", () => {
    expect(leakErrors("/t", ["conveyor-x"], ["jobs:active"])).toHaveLength(2);
  });
});
