import { describe, expect, test } from "bun:test";
import { workerConcurrency } from "./mode";

describe("workerConcurrency", () => {
  test("defaults to 2 and reads a positive integer", () => {
    expect(workerConcurrency({})).toBe(2);
    expect(workerConcurrency({ WORKER_CONCURRENCY: "" })).toBe(2);
    expect(workerConcurrency({ WORKER_CONCURRENCY: "4" })).toBe(4);
  });

  test.each(["two", "0", "-1", "1.5", " 3"])("refuses %p", (raw) => {
    expect(() => workerConcurrency({ WORKER_CONCURRENCY: raw })).toThrow(
      `WORKER_CONCURRENCY must be a positive integer, got ${raw}`,
    );
  });
});
