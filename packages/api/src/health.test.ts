import { describe, expect, test } from "bun:test";
import type { WorkerHeartbeat } from "@conveyor/shared/db";
import { type HealthChecks, type HealthReport, healthReport, WORKER_STALE_MS } from "./health";

const NOW = 1_000_000;
const READY: WorkerHeartbeat = {
  at: NOW - 5_000,
  engines: { openscad: "ok", orca: "ok", prusa: "missing" },
};

const checks = (over: Partial<HealthChecks> = {}): HealthChecks => ({
  db: () => {},
  heartbeat: () => READY,
  now: NOW,
  onError: () => {},
  ...over,
});

const fail = (message: string) => () => {
  throw new Error(message);
};

describe("healthReport", () => {
  test("ok when the database answers and a fresh worker has a generator and a slicer", async () => {
    expect(await healthReport(checks())).toEqual({
      status: "ok",
      db: "ok",
      worker: { state: "ok", lastSeenSecondsAgo: 5 },
      engines: READY.engines,
    });
  });

  test("redis is reported only when the queue uses it", async () => {
    const report = await healthReport(checks({ redis: async () => "PONG" }));
    expect(report.status).toBe("ok");
    expect(report.redis).toBe("ok");
  });

  test.each([
    ["the database", { db: fail("SQLITE_CANTOPEN") }, { db: "down" }],
    ["redis", { redis: () => Promise.reject(new Error("ECONNREFUSED")) }, { redis: "down" }],
  ])("down when %s doesn't answer", async (_name, over, part) => {
    const report = await healthReport(checks(over));
    expect(report.status).toBe("down");
    expect(report).toMatchObject(part);
  });

  test.each<[string, Partial<HealthChecks>, HealthReport["worker"]]>([
    ["no worker has written a heartbeat", { heartbeat: () => null }, { state: "missing" }],
    [
      "the worker's heartbeat is stale",
      { heartbeat: () => ({ ...READY, at: NOW - WORKER_STALE_MS - 1_000 }) },
      { state: "stale", lastSeenSecondsAgo: 46 },
    ],
  ])("degraded when %s", async (_name, over, worker) => {
    const report = await healthReport(checks(over));
    expect(report.status).toBe("degraded");
    expect(report.worker).toEqual(worker);
  });

  test.each<[string, WorkerHeartbeat["engines"], HealthReport["status"]]>([
    ["OpenSCAD is missing", { openscad: "missing", orca: "ok", prusa: "ok" }, "degraded"],
    ["no slicer is found", { openscad: "ok", orca: "missing", prusa: "missing" }, "degraded"],
    ["the engines are stubs", { openscad: "stub", orca: "stub", prusa: "stub" }, "ok"],
  ])("%s: %s", async (_name, engines, status) => {
    const report = await healthReport(checks({ heartbeat: () => ({ at: NOW, engines }) }));
    expect(report.status).toBe(status);
  });

  test("a failed check is logged but its error text never reaches the report", async () => {
    const logged: string[] = [];
    const report = await healthReport(
      checks({
        db: fail("unable to open /data/conveyor.db"),
        redis: () => Promise.reject(new Error("redis://:hunter2@redis:6379 refused")),
        onError: (check) => logged.push(check),
      }),
    );
    expect(logged).toEqual(["db", "redis"]);
    expect(JSON.stringify(report)).not.toMatch(/hunter2|conveyor\.db|refused/);
    expect(report.worker).toEqual({ state: "missing" });
  });
});
