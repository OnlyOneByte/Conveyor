import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enqueueJob } from "../queue/index.ts";
import { dbRecordJob, openDb } from "./index";
import { dbFailuresByStage, dbLiveJobCounts, dbRecentStageDurations } from "./metrics";

const dir = mkdtempSync(join(tmpdir(), "conveyor-db-metrics-"));
const db = openDb(join(dir, "conveyor.db"));
afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const request = {
  generator: { id: "gridfinity", params: {} },
  printerId: "p1",
  profileId: "x",
};

test("live counts cover only queued and running jobs, by state", () => {
  enqueueJob(db, { id: "q1", request });
  enqueueJob(db, { id: "q2", request });
  enqueueJob(db, { id: "s1", request });
  db.run("UPDATE jobs SET state = 'slicing' WHERE id = 's1'");
  dbRecordJob(db, { id: "d1", generatorId: "g", printerId: "p1", profileId: "x", state: "done" });
  expect(dbLiveJobCounts(db)).toEqual([
    { state: "queued", n: 2 },
    { state: "slicing", n: 1 },
  ]);
});

test("failures are counted by the stage they failed in", () => {
  const failed = (id: string, stage?: "slicer" | "transport") =>
    dbRecordJob(db, {
      id,
      generatorId: "g",
      printerId: "p1",
      profileId: "x",
      state: "failed",
      stage,
    });
  failed("f1", "slicer");
  failed("f2", "slicer");
  failed("f3", "transport");
  failed("f4");
  expect(dbFailuresByStage(db)).toEqual([
    { stage: null, n: 1 },
    { stage: "slicer", n: 2 },
    { stage: "transport", n: 1 },
  ]);
});

test("stage durations come from the most recent done jobs only, up to the sample", () => {
  const done = (id: string, at: number, durationMs: number) => {
    dbRecordJob(db, {
      id,
      generatorId: "g",
      printerId: "p1",
      profileId: "x",
      state: "done",
      timings: [{ stage: "slicer", enteredAt: 0, durationMs }],
    });
    db.run("UPDATE jobs SET updated_at = ? WHERE id = ?", [at, id]);
  };
  done("t1", 1, 1000);
  done("t2", 2, 2000);
  done("t3", 3, 3000);
  dbRecordJob(db, {
    id: "tf",
    generatorId: "g",
    printerId: "p1",
    profileId: "x",
    state: "failed",
    timings: [{ stage: "slicer", enteredAt: 0, durationMs: 9000 }],
  });
  expect(dbRecentStageDurations(db, 2)).toEqual([
    { stage: "slicer", durationMs: 3000 },
    { stage: "slicer", durationMs: 2000 },
  ]);
});
