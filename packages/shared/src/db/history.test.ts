import type { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JobState } from "../job";
import { dbCountJobs, dbListJobs, dbRecordJob, type HistoryPage, openDb } from "./index";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function history() {
  const dir = mkdtempSync(join(tmpdir(), "conveyor-history-"));
  dirs.push(dir);
  const db = openDb(join(dir, "conveyor.db"));
  db.exec("DELETE FROM jobs");
  return db;
}

function settle(
  db: Database,
  id: string,
  updatedAt: number,
  state: JobState = "done",
  printerId = "p1",
) {
  dbRecordJob(db, { id, generatorId: "g", printerId, profileId: "prof", state });
  db.query("UPDATE jobs SET updated_at = ? WHERE id = ?").run(updatedAt, id);
}

const ids = (db: Database, page: Partial<HistoryPage> = {}) =>
  dbListJobs(db, { limit: 50, ...page }).map((job) => job.id);

function walk(db: Database, limit: number, between: (page: number) => void = () => {}) {
  const seen: string[] = [];
  let before: HistoryPage["before"];
  for (let page = 0; page < 20; page++) {
    const jobs = dbListJobs(db, { limit, before });
    seen.push(...jobs.map((job) => job.id));
    const last = jobs.at(-1);
    if (!last) return seen;
    before = { updatedAt: last.updatedAt, id: last.id };
    between(page);
  }
  throw new Error("paging did not end");
}

describe("job history pages", () => {
  test("list finished jobs newest-finished first, breaking ties by id, and skip live ones", () => {
    const db = history();
    settle(db, "a", 100);
    settle(db, "b", 300);
    settle(db, "c", 300);
    settle(db, "live", 400, "printing");
    expect(ids(db)).toEqual(["c", "b", "a"]);
    expect(ids(db, { limit: 2 })).toEqual(["c", "b"]);
  });

  test("a cursor walks every job once, even when several share a finish time", () => {
    const db = history();
    for (const [i, at] of [100, 200, 200, 200, 300, 400, 400].entries()) settle(db, `j${i}`, at);
    expect(walk(db, 2)).toEqual(["j6", "j5", "j4", "j3", "j2", "j1", "j0"]);
  });

  test("jobs that finish while paging go to the front and never into a later page", () => {
    const db = history();
    for (let i = 0; i < 5; i++) settle(db, `old${i}`, 100 + i);
    const seen = walk(db, 2, (page) => settle(db, `new${page}`, 1_000 + page));
    expect(seen).toEqual(["old4", "old3", "old2", "old1", "old0"]);
    expect(ids(db, { limit: 3 })).toEqual(["new2", "new1", "new0"]);
  });

  test("filter by state, printer and finish time, with since inclusive and until exclusive", () => {
    const db = history();
    settle(db, "done-p1", 100);
    settle(db, "failed-p1", 200, "failed");
    settle(db, "done-p2", 300, "done", "p2");
    settle(db, "canceled-p2", 400, "canceled", "p2");
    expect(ids(db, { state: "failed" })).toEqual(["failed-p1"]);
    expect(ids(db, { printerId: "p2" })).toEqual(["canceled-p2", "done-p2"]);
    expect(ids(db, { since: 200, until: 400 })).toEqual(["done-p2", "failed-p1"]);
    expect(ids(db, { state: "done", printerId: "p2", since: 300 })).toEqual(["done-p2"]);
    expect(ids(db, { printerId: "nowhere" })).toEqual([]);
  });

  test("count finished jobs per state under the same printer and time filters", () => {
    const db = history();
    settle(db, "a", 100);
    settle(db, "b", 200, "failed");
    settle(db, "c", 300);
    settle(db, "d", 400, "done", "p2");
    settle(db, "live", 500, "slicing");
    expect(dbCountJobs(db)).toEqual({ done: 3, failed: 1, canceled: 0 });
    expect(dbCountJobs(db, { printerId: "p1", since: 150 })).toEqual({
      done: 1,
      failed: 1,
      canceled: 0,
    });
    expect(dbCountJobs(db, { until: 100 })).toEqual({ done: 0, failed: 0, canceled: 0 });
  });
});
