import type { Database } from "bun:sqlite";
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dbCountJobs, dbGetJob, dbListJobs, dbListNeedsYou, dbRecordJob, openDb } from "./index";

const dirs: string[] = [];
const fresh = (name: string) => `${name}-${randomUUID()}`;

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function withJobs(): Database {
  const dir = mkdtempSync(join(tmpdir(), "conveyor-unreadable-"));
  dirs.push(dir);
  const db = openDb(join(dir, "conveyor.db"));
  db.exec("DELETE FROM jobs");
  const error = { stage: "slicer" as const, reason: "boom" };
  for (const [id, at] of [
    ["good-1", 1_000],
    ["bad", 2_000],
    ["good-2", 3_000],
  ] as const) {
    dbRecordJob(db, {
      id,
      generatorId: "gridfinity",
      params: { gridX: 2 },
      printerId: "p1",
      profileId: "prof",
      state: "failed",
      error,
      timings: [{ stage: "slicer", enteredAt: 0, durationMs: 5 }],
    });
    db.query("UPDATE jobs SET updated_at = ? WHERE id = ?").run(at, id);
  }
  return db;
}

describe("history rows with an unreadable JSON column", () => {
  test("a corrupt params, error or timings column is left out and named, and the other jobs are listed whole", () => {
    const db = withJobs();
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      db.query(
        "UPDATE jobs SET params_json = '{', error_json = 'nope', timings_json = '[' WHERE id = 'bad'",
      ).run();
      const listed = dbListJobs(db, { limit: 50 });
      expect(listed.map((job) => job.id)).toEqual(["good-2", "bad", "good-1"]);
      const bad = listed.find((job) => job.id === "bad");
      expect(bad).toMatchObject({ state: "failed", unreadable: ["params", "error", "timings"] });
      expect(bad?.request.generator).toEqual({ id: "gridfinity", params: undefined });
      expect(bad?.error).toBeUndefined();
      expect(bad?.timings).toBeUndefined();
      const good = listed.find((job) => job.id === "good-1");
      expect(good).not.toHaveProperty("unreadable");
      expect(good?.request.generator.params).toEqual({ gridX: 2 });
      expect(good?.error).toEqual({ stage: "slicer", reason: "boom" });
      expect(dbGetJob(db, "bad")?.unreadable).toEqual(["params", "error", "timings"]);
      expect(dbListNeedsYou(db).map((job) => job.id)).toEqual(["good-2", "bad", "good-1"]);
      expect(dbCountJobs(db).failed).toBe(3);
    } finally {
      warn.mockRestore();
    }
  });

  test('JSON of the wrong shape is unreadable too: params 7, error "boom", timings {}', () => {
    const db = withJobs();
    const id = fresh("bad-shape");
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      db.query(
        `UPDATE jobs SET id = ?, params_json = '7', error_json = '"boom"', timings_json = '{}'
          WHERE id = 'bad'`,
      ).run(id);
      const bad = dbGetJob(db, id);
      expect(bad?.unreadable).toEqual(["params", "error", "timings"]);
      expect(bad?.request.generator.params).toBeUndefined();
      expect(bad?.error).toBeUndefined();
      expect(bad?.timings).toBeUndefined();
      db.query(
        `UPDATE jobs SET error_json = '{"stage":"printing","reason":"x"}',
          timings_json = '[{"stage":"slicer"}]', params_json = '[1]' WHERE id = ?`,
      ).run(id);
      expect(dbGetJob(db, id)?.unreadable).toEqual(["params", "error", "timings"]);
      expect(dbGetJob(db, "good-1")).not.toHaveProperty("unreadable");
      expect(warn.mock.calls.map(([line]) => line)).toEqual([
        `[jobs] job ${id} has an unreadable params column; listing it without it`,
        `[jobs] job ${id} has an unreadable error column; listing it without it`,
        `[jobs] job ${id} has an unreadable timings column; listing it without it`,
      ]);
    } finally {
      warn.mockRestore();
    }
  });

  test("each unreadable column of a job is logged once, naming the job and the column", () => {
    const db = withJobs();
    const id = fresh("bad-logged");
    db.query("UPDATE jobs SET id = ?, params_json = '{' WHERE id = 'bad'").run(id);
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      dbListJobs(db, { limit: 50 });
      dbListJobs(db, { limit: 50 });
      dbGetJob(db, id);
      expect(warn.mock.calls).toEqual([
        [`[jobs] job ${id} has an unreadable params column; listing it without it`],
      ]);
    } finally {
      warn.mockRestore();
    }
  });

  test("a stage that isn't one is left out as null and named stage", () => {
    const db = withJobs();
    const id = fresh("bad-stage");
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      db.query("UPDATE jobs SET id = ?, stage = 'printing' WHERE id = 'bad'").run(id);
      db.query("UPDATE jobs SET stage = 'slicer' WHERE id = 'good-1'").run();
      expect(dbGetJob(db, id)).toMatchObject({ stage: null, unreadable: ["stage"] });
      expect(dbGetJob(db, "good-1")).toMatchObject({ stage: "slicer" });
      expect(dbGetJob(db, "good-1")).not.toHaveProperty("unreadable");
      expect(warn.mock.calls).toEqual([
        [`[jobs] job ${id} has an unreadable stage column; listing it without it`],
      ]);
    } finally {
      warn.mockRestore();
    }
  });

  test("a job in a state Conveyor doesn't know is left out, not given a made-up state", () => {
    const db = withJobs();
    const id = fresh("bad-state");
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      db.query("UPDATE jobs SET id = ?, state = 'exploded' WHERE id = 'bad'").run(id);
      expect(dbGetJob(db, id)).toBeNull();
      expect(dbGetJob(db, id)).toBeNull();
      expect(dbGetJob(db, "good-1")?.state).toBe("failed");
      expect(warn.mock.calls).toEqual([
        [`[jobs] job ${id} has an unknown state exploded; leaving it out`],
      ]);
    } finally {
      warn.mockRestore();
    }
  });
});
