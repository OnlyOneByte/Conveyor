import type { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { filesToPrune, type PrintStatus, type Stage, StageError } from "@conveyor/shared";
import { dbGetJob, dbRecordJob, openDb, queuedCancelRecord } from "@conveyor/shared/db";
import { enqueueJob, requestCancel } from "@conveyor/shared/queue";
import { type HarnessOptions, harness } from "../test/helpers/pipeline-harness";
import { settledJob } from "./index";
import { filesToKeep } from "./printer-files";
import { createRedisReaper } from "./redis-reaper";
import type { PipelineDeps } from "./run";

async function* failsMidPrint(): AsyncIterable<PrintStatus> {
  yield { state: "printing", progress: 0.2 };
  yield { state: "failed", message: "nozzle clog" };
}

describe("filesToKeep", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  interface Row {
    id: string;
    printerId: string;
    at: number;
    stage?: Stage;
  }

  function dbWith(jobs: Row[]) {
    const dir = mkdtempSync(join(tmpdir(), "conveyor-printer-files-"));
    dirs.push(dir);
    const db = openDb(join(dir, "conveyor.db"));
    for (const { id, printerId, stage } of jobs)
      dbRecordJob(db, { id, generatorId: "g", printerId, profileId: "x", state: "done", stage });
    for (const { id, at } of jobs) db.run("UPDATE jobs SET updated_at = ? WHERE id = ?", [at, id]);
    return db;
  }

  test("keeps this job's file and the printer's most recent earlier ones, up to N", () => {
    const db = dbWith([
      { id: "old", printerId: "p1", at: 1 },
      { id: "new", printerId: "p1", at: 3 },
      { id: "mid", printerId: "p1", at: 2 },
      { id: "other", printerId: "p2", at: 4 },
    ]);
    expect(filesToKeep(db, 3, "p1", "now")).toEqual([
      "conveyor-now.gcode",
      "conveyor-new.gcode",
      "conveyor-mid.gcode",
    ]);
    expect(filesToKeep(db, 1, "p1", "now")).toEqual(["conveyor-now.gcode"]);
  });

  async function settle(db: Database, id: string, at: number, opts: HarnessOptions = {}) {
    const record: PipelineDeps["record"] = (_id, req, extra) =>
      dbRecordJob(db, settledJob(id, req, extra));
    await harness({ ...opts, deps: () => ({ record }) })
      .run()
      .catch(() => undefined);
    db.run("UPDATE jobs SET updated_at = ? WHERE id = ?", [at, id]);
  }

  const failsAt = (stage: "generator" | "slicer") => async () => {
    throw new StageError(stage, `${stage} broke`);
  };

  test("counts only jobs that reached the printer toward N, as the worker records them", async () => {
    const db = dbWith([]);
    await settle(db, "printed", 1);
    await settle(db, "failed-printing", 2, { status: failsMidPrint });
    await settle(db, "sliced-badly", 3, { slice: failsAt("slicer") });
    await settle(db, "never-made", 4, { generate: failsAt("generator") });
    expect(dbGetJob(db, "printed")?.state).toBe("done");
    expect(db.query("SELECT stage FROM jobs WHERE id = 'printed'").get()).toEqual({ stage: null });
    expect(dbGetJob(db, "never-made")?.state).toBe("failed");
    expect(filesToKeep(db, 3, "p1", "now")).toEqual([
      "conveyor-now.gcode",
      "conveyor-failed-printing.gcode",
      "conveyor-printed.gcode",
    ]);
    expect(filesToKeep(db, 2, "p1", "now")).toEqual([
      "conveyor-now.gcode",
      "conveyor-failed-printing.gcode",
    ]);
  });

  const queuedRequest = {
    generator: { id: "gridfinity", params: { gridX: 1, gridY: 1, heightUnits: 3 } },
    printerId: "p1",
    profileId: "orca/klipper-pla-0.2",
  };

  const canceledRow = (db: Database) =>
    db.query("SELECT state, stage, printer_id FROM jobs WHERE id = 'queued-cancel'").get();

  test("a job canceled while queued in Redis mode takes no keep slot", async () => {
    const db = dbWith([]);
    await settle(db, "printed", 1);
    dbRecordJob(db, queuedCancelRecord("queued-cancel", queuedRequest));
    db.run("UPDATE jobs SET updated_at = 2 WHERE id = 'queued-cancel'");
    expect(canceledRow(db)).toEqual({ state: "canceled", stage: null, printer_id: "p1" });
    expect(filesToKeep(db, 2, "p1", "now")).toEqual([
      "conveyor-now.gcode",
      "conveyor-printed.gcode",
    ]);
  });

  test("a job canceled while queued in SQLite mode takes no keep slot", async () => {
    const db = dbWith([]);
    await settle(db, "printed", 1);
    enqueueJob(db, { id: "queued-cancel", request: queuedRequest });
    expect(requestCancel(db, "queued-cancel")).toEqual({ kind: "canceled" });
    db.run("UPDATE jobs SET updated_at = 2 WHERE id = 'queued-cancel'");
    expect(canceledRow(db)).toEqual({ state: "canceled", stage: null, printer_id: "p1" });
    expect(filesToKeep(db, 2, "p1", "now")).toEqual([
      "conveyor-now.gcode",
      "conveyor-printed.gcode",
    ]);
  });

  test("a job that ended before any stage started takes no keep slot", async () => {
    const db = dbWith([]);
    await settle(db, "printed", 1);
    const orphan = {
      generator: { id: "gridfinity", params: { gridX: 1, gridY: 1, heightUnits: 3 } },
      printerId: "p1",
      profileId: "orca/klipper-pla-0.2",
    };
    await createRedisReaper({
      db: () => db,
      activeIds: async () => ["orphan"],
      snapshot: async () => undefined,
      queued: async () => ({ state: "failed", data: orphan }),
      publish: async () => undefined,
      now: () => 2,
      log: () => {},
    }).sweep();
    db.run("UPDATE jobs SET updated_at = 2 WHERE id = 'orphan'");
    expect(db.query("SELECT state, stage, printer_id FROM jobs WHERE id = 'orphan'").get()).toEqual(
      {
        state: "failed",
        stage: null,
        printer_id: "p1",
      },
    );
    expect(filesToKeep(db, 2, "p1", "now")).toEqual([
      "conveyor-now.gcode",
      "conveyor-printed.gcode",
    ]);
  });

  test("a canceled or failed job's file is deleted by a later job's prune once it falls out of the last N", () => {
    const db = dbWith([]);
    const rows: { id: string; state: "canceled" | "failed" | "done"; at: number }[] = [
      { id: "canceled-printing", state: "canceled", at: 1 },
      { id: "failed-printing", state: "failed", at: 2 },
      { id: "printed", state: "done", at: 3 },
    ];
    for (const { id, state } of rows)
      dbRecordJob(db, {
        id,
        generatorId: "g",
        printerId: "p1",
        profileId: "x",
        state,
        stage: "transport",
      });
    for (const { id, at } of rows) db.run("UPDATE jobs SET updated_at = ? WHERE id = ?", [at, id]);
    const onPrinter = [
      "conveyor-canceled-printing.gcode",
      "conveyor-failed-printing.gcode",
      "conveyor-printed.gcode",
      "conveyor-now.gcode",
      "my-own-part.gcode",
    ];
    const keep = new Set(filesToKeep(db, 2, "p1", "now"));
    expect(filesToPrune(onPrinter, keep, "conveyor-now.gcode")).toEqual([
      "conveyor-canceled-printing.gcode",
      "conveyor-failed-printing.gcode",
    ]);
    const roomy = new Set(filesToKeep(db, 5, "p1", "now"));
    expect(filesToPrune(onPrinter, roomy, "conveyor-now.gcode")).toEqual([]);
  });

  test("keeps no earlier job's file at 0, nor names this job's own", () => {
    expect(filesToKeep(dbWith([{ id: "a", printerId: "p1", at: 1 }]), 0, "p1", "now")).toEqual([]);
  });

  test("counts this job once even if its row is already there", () => {
    const db = dbWith([
      { id: "now", printerId: "p1", at: 2 },
      { id: "a", printerId: "p1", at: 1 },
    ]);
    expect(filesToKeep(db, 2, "p1", "now")).toEqual(["conveyor-now.gcode", "conveyor-a.gcode"]);
  });
});
