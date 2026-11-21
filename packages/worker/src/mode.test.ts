import { describe, expect, test } from "bun:test";
import { queueMode, workerConcurrency } from "./mode";

describe("queueMode", () => {
  test("defaults to redis", () => {
    expect(queueMode({})).toBe("redis");
    expect(queueMode({ CONVEYOR_QUEUE: "" })).toBe("redis");
  });

  test("refuses sqlite until CONVEYOR_QUEUE_UNSTABLE=1 is set", () => {
    expect(() => queueMode({ CONVEYOR_QUEUE: "sqlite" })).toThrow("CONVEYOR_QUEUE_UNSTABLE=1");
    expect(queueMode({ CONVEYOR_QUEUE: "sqlite", CONVEYOR_QUEUE_UNSTABLE: "1" })).toBe("sqlite");
  });

  test("refuses an unknown mode", () => {
    expect(() => queueMode({ CONVEYOR_QUEUE: "postgres" })).toThrow("got postgres");
  });
});

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
