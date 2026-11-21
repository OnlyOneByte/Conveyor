import { describe, expect, test } from "bun:test";
import { queueMode } from "./mode";

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
