import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { queueMode } from "./queue-mode.ts";

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

describe("the compose file", () => {
  const compose = readFileSync(join(import.meta.dir, "../../../docker-compose.yml"), "utf8");
  const service = (name: string) =>
    compose.split(/\n {2}(?=\w[\w-]*:\n)/).find((s) => s.startsWith(`${name}:`));

  test.each(["api", "worker"])(
    "passes the one CONVEYOR_QUEUE value, redis by default, to %s",
    (name) => {
      expect(service(name)).toContain("- CONVEYOR_QUEUE=${CONVEYOR_QUEUE:-redis}");
      expect(service(name)).toContain("- CONVEYOR_QUEUE_UNSTABLE=${CONVEYOR_QUEUE_UNSTABLE:-}");
    },
  );
});
