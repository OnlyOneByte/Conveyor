import { describe, expect, test } from "bun:test";
import type { WorkerBeat } from "@conveyor/shared/db";
import { ago, HEARTBEAT_SKEW_MS, type HealthChecks, healthReport, WORKER_STALE_MS } from "./health";

const NOW = 10_000_000;
const HOUR_AHEAD = 60 * 60 * 1000;
const READY: WorkerBeat = {
  id: "w1",
  at: NOW - 5_000,
  engines: { openscad: "ok", orca: "ok", prusa: "missing" },
};

const checks = (over: Partial<HealthChecks> = {}): HealthChecks => ({
  db: () => {},
  uploads: async () => {},
  heartbeats: () => [READY],
  now: NOW,
  onError: () => {},
  ...over,
});

const fail = (message: string) => () => {
  throw new Error(message);
};

describe("healthReport", () => {
  test("ok, in plain words for every check, when everything answers", async () => {
    expect(await healthReport(checks())).toEqual({
      status: "ok",
      says: "Conveyor is ready to print.",
      db: { state: "ok", says: "The job database answers." },
      uploads: { state: "ok", says: "The uploads folder takes new files." },
      workers: [
        {
          id: "w1",
          state: "ok",
          lastSeenSecondsAgo: 5,
          says: "Checked in 5 s ago.",
          engines: {
            openscad: { state: "ok", says: "OpenSCAD is installed." },
            orca: { state: "ok", says: "OrcaSlicer is installed." },
            prusa: {
              state: "missing",
              says: "PrusaSlicer wasn't found. Install it or set PRUSA_BIN.",
            },
          },
        },
      ],
    });
  });

  test("redis is reported only when the queue uses it", async () => {
    expect((await healthReport(checks())).redis).toBeUndefined();
    const report = await healthReport(checks({ redis: async () => "PONG" }));
    expect(report.redis).toEqual({ state: "ok", says: "The queue answers." });
  });

  test.each([
    ["the database", { db: fail("SQLITE_CANTOPEN") }, "The job database didn't answer."],
    [
      "redis",
      { redis: () => Promise.reject(new Error("ECONNREFUSED")) },
      "The queue (Redis) didn't answer.",
    ],
  ])("down when %s doesn't answer, and says so", async (_name, over, says) => {
    const report = await healthReport(checks(over));
    expect(report).toMatchObject({ status: "down", says });
  });

  test("degraded when the uploads folder can't take a file", async () => {
    const report = await healthReport(
      checks({ uploads: () => Promise.reject(new Error("EROFS")) }),
    );
    expect(report).toMatchObject({
      status: "degraded",
      says: "The uploads folder can't take new files. It may be full or read-only.",
      uploads: { state: "down" },
    });
  });

  test("a worker that stops beating shows as down once its beat is over 45 s old", async () => {
    const at = (ageMs: number) => checks({ heartbeats: () => [{ ...READY, at: NOW - ageMs }] });
    expect((await healthReport(at(WORKER_STALE_MS))).workers[0]?.state).toBe("ok");
    const stopped = await healthReport(at(WORKER_STALE_MS + 1_000));
    expect(stopped.status).toBe("degraded");
    expect(stopped.workers[0]).toMatchObject({
      state: "down",
      lastSeenSecondsAgo: 46,
      says: "Last checked in 46 s ago, so it has probably stopped.",
    });
  });

  test("a heartbeat dated in the future reads as down once past the skew allowance", async () => {
    const at = (aheadMs: number) =>
      checks({ heartbeats: () => [READY, { ...READY, id: "w2", at: NOW + aheadMs }] });
    expect((await healthReport(at(HEARTBEAT_SKEW_MS))).workers[1]).toMatchObject({
      state: "ok",
      says: "Checked in 0 s ago.",
    });
    const ahead = await healthReport(at(HEARTBEAT_SKEW_MS + 1_000));
    expect(ahead.status).toBe("degraded");
    expect(ahead.says).toBe(
      "Worker w2's last check-in is dated in the future, so the clock may have been changed.",
    );
    expect(ahead.workers[1]).toMatchObject({ state: "down", future: true, lastSeenSecondsAgo: 0 });
    const alone = await healthReport(
      checks({ heartbeats: () => [{ ...READY, at: NOW + HOUR_AHEAD }] }),
    );
    expect(alone.status).toBe("degraded");
  });

  test("one stopped worker among live ones is named, though jobs still run", async () => {
    const report = await healthReport(
      checks({ heartbeats: () => [READY, { ...READY, id: "w2", at: NOW - 10 * 60_000 }] }),
    );
    expect(report.status).toBe("degraded");
    expect(report.says).toBe("Worker w2 last checked in 10 min ago, so it has probably stopped.");
    expect(report.workers.map((worker) => worker.state)).toEqual(["ok", "down"]);
  });

  test.each<[string, WorkerBeat["engines"], string]>([
    [
      "OpenSCAD is missing",
      { openscad: "missing", orca: "ok", prusa: "ok" },
      "No running worker has a generator and a slicer, so jobs won't run.",
    ],
    [
      "no slicer is found",
      { openscad: "ok", orca: "missing", prusa: "missing" },
      "No running worker has a generator and a slicer, so jobs won't run.",
    ],
    [
      "the engines are stand-ins",
      { openscad: "stub", orca: "stub", prusa: "stub" },
      "Conveyor is ready to print.",
    ],
  ])("%s", async (_name, engines, says) => {
    const report = await healthReport(checks({ heartbeats: () => [{ ...READY, engines }] }));
    expect(report.says).toBe(says);
  });

  test("no worker at all, or a heartbeat that can't be read, says no worker has checked in", async () => {
    const logged: string[] = [];
    for (const heartbeats of [() => [], fail("database is locked")]) {
      const report = await healthReport(
        checks({ heartbeats, onError: (check) => logged.push(check) }),
      );
      expect(report).toMatchObject({
        status: "degraded",
        says: "No worker has checked in, so jobs won't run.",
        workers: [],
      });
    }
    expect(logged).toEqual(["worker heartbeat"]);
  });

  test("a failed check is logged but its error text never reaches the report", async () => {
    const logged: string[] = [];
    const report = await healthReport(
      checks({
        db: fail("unable to open /data/conveyor.db"),
        redis: () => Promise.reject(new Error("redis://:hunter2@redis:6379 refused")),
        uploads: () => Promise.reject(new Error("EACCES /data/uploads/.health-1")),
        onError: (check) => logged.push(check),
      }),
    );
    expect(logged).toEqual(["db", "redis", "uploads"]);
    expect(JSON.stringify(report)).not.toMatch(/hunter2|conveyor\.db|refused|EACCES/);
    expect(report.workers).toEqual([]);
  });
});

test("ages read in seconds, then minutes, then hours", () => {
  expect([0, 89_000, 90_000, 89 * 60_000, 90 * 60_000, 5 * 3_600_000].map(ago)).toEqual([
    "0 s",
    "89 s",
    "2 min",
    "89 min",
    "2 h",
    "5 h",
  ]);
});
