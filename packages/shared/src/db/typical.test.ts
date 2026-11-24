import { describe, expect, test } from "bun:test";
import type { JobState, StageTiming } from "../job";
import { dbRecordJob, dbTypicalStageMs, openDb } from "./index";

type Pick = { state?: JobState; generatorId?: string; printerId?: string; slicer?: number };

function history() {
  const db = openDb(":memory:");
  db.exec("DELETE FROM jobs");
  let n = 0;
  const settle = (generator: number, { slicer, ...opts }: Pick = {}) => {
    const id = `j${++n}`;
    const timings: StageTiming[] = [{ stage: "generator", enteredAt: 0, durationMs: generator }];
    if (slicer !== undefined) timings.push({ stage: "slicer", enteredAt: 1, durationMs: slicer });
    const job = {
      generatorId: "gridfinity",
      printerId: "p1",
      profileId: "prof",
      state: "done" as const,
    };
    dbRecordJob(db, { ...job, ...opts, id, timings });
    db.query("UPDATE jobs SET updated_at = ? WHERE id = ?").run(n, id);
  };
  return { db, settle };
}

const pair = { generatorId: "gridfinity", printerId: "p1" };

describe("typical stage durations", () => {
  test("are each stage's median over the pair's finished jobs, with at least three samples", () => {
    const { db, settle } = history();
    settle(10, { slicer: 100 });
    settle(30);
    settle(20, { slicer: 300 });
    expect(dbTypicalStageMs(db, pair)).toEqual({ generator: 20 });
    settle(40, { slicer: 200 });
    expect(dbTypicalStageMs(db, pair)).toEqual({ generator: 25, slicer: 200 });
    expect(dbTypicalStageMs(history().db, pair)).toEqual({});
  });

  test("count only finished jobs of the same generator and printer, newest first", () => {
    const { db, settle } = history();
    for (const ms of [900, 900, 900, 10, 20, 30]) settle(ms);
    for (const state of ["failed", "canceled"] as const) settle(5_000, { state });
    settle(5_000, { generatorId: "other" });
    settle(5_000, { printerId: "p2" });
    expect(dbTypicalStageMs(db, pair, 3)).toEqual({ generator: 20 });
    expect(dbTypicalStageMs(db, pair)).toEqual({ generator: 465 });
  });

  test("skip timings it cannot read", () => {
    const { db, settle } = history();
    for (const ms of [10, 20, 30, 0]) settle(ms);
    db.query("UPDATE jobs SET timings_json = '[{\"stage\":\"x\"}]' WHERE id = 'j4'").run();
    expect(dbTypicalStageMs(db, pair)).toEqual({ generator: 20 });
  });
});
