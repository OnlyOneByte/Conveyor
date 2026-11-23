import type { Database } from "bun:sqlite";
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeLegacyStationDb } from "../../test/helpers/legacy-db.ts";
import { dbGetJob, dbRecordJob, openDb } from "./index";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const LEGACY_JOBS_TRIGGER = `
CREATE TABLE job_state_log (job_id TEXT NOT NULL, state TEXT NOT NULL);
CREATE TRIGGER trg_jobs_state AFTER UPDATE OF state ON jobs
BEGIN
  INSERT INTO job_state_log VALUES (NEW.id, NEW.state);
END;
`;

const LEGACY_STATION_TRIGGER = `
CREATE TABLE station_log (station_id TEXT);
CREATE TRIGGER trg_jobs_station AFTER UPDATE ON jobs
BEGIN
  INSERT INTO station_log VALUES (NEW.station_id);
END;
`;

const LEGACY_STATIONS_TABLE_TRIGGER = `
CREATE TABLE station_name_log (name TEXT);
CREATE TRIGGER trg_jobs_station AFTER UPDATE ON jobs
BEGIN
  INSERT INTO station_name_log SELECT name FROM "Stations" WHERE printer_id = 'printer-a';
END;
`;

const STATION_TRIGGERS = [
  { reads: "names station_id", sql: LEGACY_STATION_TRIGGER, kept: "NEW.station_id" },
  {
    reads: "selects from a quoted Stations",
    sql: LEGACY_STATIONS_TABLE_TRIGGER,
    kept: '"Stations"',
  },
];

function openLegacyDb(extraSql = ""): Database {
  const dir = mkdtempSync(join(tmpdir(), "conveyor-migrate-"));
  dirs.push(dir);
  const path = join(dir, "conveyor.db");
  writeLegacyStationDb(path, extraSql);
  return openDb(path);
}

function namesOf(db: Database, sql: string): string[] {
  return db
    .query<{ name: string }, []>(sql)
    .all()
    .map((row) => row.name);
}

describe("openDb legacy station migration", () => {
  test("backfills each job's printer and profile from its station", () => {
    const db = openLegacyDb();
    expect(dbGetJob(db, "job-a")?.request).toMatchObject({
      printerId: "printer-a",
      profileId: "profile-a",
    });
    expect(dbGetJob(db, "job-b")?.request).toMatchObject({
      printerId: "printer-b",
      profileId: "profile-b",
    });
  });

  test("leaves printer and profile empty for a job whose station was deleted", () => {
    const db = openLegacyDb();
    expect(dbGetJob(db, "job-gone")?.request).toMatchObject({ printerId: "", profileId: "" });
  });

  test("drops the stations table and the station_id column", () => {
    const db = openLegacyDb();
    expect(namesOf(db, "SELECT name FROM sqlite_master WHERE type = 'table'")).not.toContain(
      "stations",
    );
    expect(namesOf(db, "PRAGMA table_info(jobs)")).not.toContain("station_id");
  });

  test("keeps idx_jobs_created_at on jobs right after the migration", () => {
    const db = openLegacyDb();
    expect(
      namesOf(db, "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'jobs'"),
    ).toContain("idx_jobs_created_at");
  });

  test("keeps a legacy trigger on jobs and it still fires after the migration", () => {
    const db = openLegacyDb(LEGACY_JOBS_TRIGGER);
    expect(
      namesOf(db, "SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'jobs'"),
    ).toEqual(["trg_jobs_state"]);
    dbRecordJob(db, {
      id: "job-a",
      generatorId: "gen",
      printerId: "printer-a",
      profileId: "profile-a",
      state: "canceled",
      notes: "work dir not removed",
    });
    expect(db.query("SELECT job_id, state FROM job_state_log").all()).toEqual([
      { job_id: "job-a", state: "canceled" },
    ]);
    expect(dbGetJob(db, "job-a")).toMatchObject({
      state: "canceled",
      notes: "work dir not removed",
    });
  });

  for (const station of STATION_TRIGGERS) {
    test(`drops a legacy trigger that ${station.reads}, keeps its SQL in meta and warns`, () => {
      const warn = spyOn(console, "warn").mockImplementation(() => undefined);
      const db = openLegacyDb(LEGACY_JOBS_TRIGGER + station.sql);
      const warnings = warn.mock.calls.map((call) => String(call[0]));
      warn.mockRestore();
      expect(
        namesOf(db, "SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'jobs'"),
      ).toEqual(["trg_jobs_state"]);
      expect(
        db
          .query<{ value: string }, []>(
            "SELECT value FROM meta WHERE key = 'dropped_trigger:trg_jobs_station'",
          )
          .get()?.value,
      ).toContain(station.kept);
      expect(warnings).toEqual([expect.stringContaining("dropped trigger trg_jobs_station")]);
      dbRecordJob(db, {
        id: "job-a",
        generatorId: "gen",
        printerId: "printer-a",
        profileId: "profile-a",
        state: "failed",
      });
      expect(dbGetJob(db, "job-a")?.state).toBe("failed");
      expect(db.query("SELECT job_id, state FROM job_state_log").all()).toEqual([
        { job_id: "job-a", state: "failed" },
      ]);
    });
  }

  test("adds timings_json and filament_json to the migrated jobs table", () => {
    const db = openLegacyDb();
    expect(namesOf(db, "PRAGMA table_info(jobs)")).toEqual(
      expect.arrayContaining(["timings_json", "filament_json"]),
    );
  });

  test("adds notes to the migrated jobs table", () => {
    const db = openLegacyDb();
    expect(namesOf(db, "PRAGMA table_info(jobs)")).toContain("notes");
  });

  test("adds the queue columns and indexes, and runs at synchronous NORMAL", () => {
    const db = openLegacyDb();
    expect(namesOf(db, "PRAGMA table_info(jobs)")).toEqual(
      expect.arrayContaining([
        "attempts",
        "lease_owner",
        "lease_token",
        "lease_until",
        "submitted_at",
      ]),
    );
    expect(namesOf(db, "PRAGMA index_list(jobs)")).toEqual(
      expect.arrayContaining(["idx_jobs_claim", "idx_jobs_lease", "idx_jobs_printer_live"]),
    );
    expect(namesOf(db, "PRAGMA table_info(printers)")).toEqual(
      expect.arrayContaining(["hold_job_id", "hold_reason", "hold_at"]),
    );
    expect(db.query<{ synchronous: number }, []>("PRAGMA synchronous").get()).toEqual({
      synchronous: 1,
    });
  });
});
