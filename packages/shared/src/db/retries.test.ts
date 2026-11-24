import type { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JobState } from "../job";
import { dbListNeedsYou, dbMarkRetried, dbRecordJob, dbRetryProblem, openDb } from "./index";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function jobs(...states: [string, JobState][]): Database {
  const dir = mkdtempSync(join(tmpdir(), "conveyor-retries-"));
  dirs.push(dir);
  const db = openDb(join(dir, "conveyor.db"));
  db.exec("DELETE FROM jobs");
  for (const [id, state] of states) {
    dbRecordJob(db, { id, generatorId: "g", printerId: "p1", profileId: "prof", state });
  }
  return db;
}

const needsYou = (db: Database) => dbListNeedsYou(db).map((job) => job.id);

describe("retrying a failed job", () => {
  test("only a known, failed job can be retried, and the problem names retryOf", () => {
    const db = jobs(["broke", "failed"], ["fine", "done"], ["stopped", "canceled"]);
    expect([dbRetryProblem(db, "broke"), dbRetryProblem(db, "fine")]).toEqual([
      null,
      "retryOf: job fine is done, not failed",
    ]);
    expect([dbRetryProblem(db, "stopped"), dbRetryProblem(db, "nope")]).toEqual([
      "retryOf: job stopped is canceled, not failed",
      "retryOf: unknown job nope",
    ]);
  });

  test("a retried failure leaves the Needs-you list; other failures stay", () => {
    const db = jobs(["broke", "failed"], ["also-broke", "failed"]);
    dbMarkRetried(db, "broke", "retry-1");
    expect(needsYou(db)).toEqual(["also-broke"]);
    const row = db.query("SELECT retried_by FROM jobs WHERE id = 'broke'").get();
    expect(row).toEqual({ retried_by: "retry-1" });
  });

  test("marking a job that isn't failed changes nothing", () => {
    const db = jobs(["fine", "done"]);
    dbMarkRetried(db, "fine", "retry-1");
    dbMarkRetried(db, "nope", "retry-2");
    expect(db.query("SELECT id, retried_by FROM jobs").all()).toEqual([
      { id: "fine", retried_by: null },
    ]);
  });
});
