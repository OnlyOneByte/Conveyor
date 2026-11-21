import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  dbGetJob,
  dbGetOrcaProfileDocuments,
  dbGetPrinter,
  dbGetProfile,
  dbGetPrusaProfileContent,
  dbSaveOrcaProfileDocuments,
  dbSavePrusaProfileContent,
  dbUpsertPrinter,
  openDb,
} from "./index";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const LEGACY_STATION_SCHEMA = `
CREATE TABLE IF NOT EXISTS profiles (
  id            TEXT PRIMARY KEY,
  slicer_id     TEXT NOT NULL,
  name          TEXT NOT NULL,
  path          TEXT NOT NULL,
  gcode_flavor  TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS printers (
  id            TEXT PRIMARY KEY,
  transport_id  TEXT NOT NULL,
  name          TEXT NOT NULL,
  address       TEXT NOT NULL,
  secrets_json  TEXT,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS stations (
  id                       TEXT PRIMARY KEY,
  name                     TEXT NOT NULL,
  transport_id             TEXT NOT NULL,
  printer_id               TEXT NOT NULL,
  slicer_id                TEXT NOT NULL,
  profile_id               TEXT NOT NULL,
  allowed_generators_json  TEXT,
  created_at               INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id            TEXT PRIMARY KEY,
  generator_id  TEXT NOT NULL,
  params_json   TEXT,
  station_id    TEXT NOT NULL,
  state         TEXT NOT NULL,
  stage         TEXT,
  error_json    TEXT,
  model_path    TEXT,
  gcode_path    TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs (created_at DESC);
`;

function writeLegacyDb(path: string): void {
  const legacy = new Database(path, { create: true });
  legacy.exec(LEGACY_STATION_SCHEMA);
  legacy.exec(`INSERT INTO printers VALUES ('printer-a', 'moonraker', 'Legacy A', 'http://a', NULL, 1);
INSERT INTO profiles VALUES ('profile-a', 'orca', 'Legacy PLA', '/profiles/a', 'klipper', 1);
INSERT INTO stations VALUES
  ('st-a', 'Station A', 'moonraker', 'printer-a', 'orca', 'profile-a', NULL, 1),
  ('st-b', 'Station B', 'moonraker', 'printer-b', 'orca', 'profile-b', NULL, 1);
INSERT INTO jobs VALUES
  ('job-a', 'gen', NULL, 'st-a', 'done', NULL, NULL, NULL, NULL, 1, 1),
  ('job-b', 'gen', NULL, 'st-b', 'done', NULL, NULL, NULL, NULL, 2, 2),
  ('job-gone', 'gen', NULL, 'st-deleted', 'failed', NULL, NULL, NULL, NULL, 3, 3);`);
  legacy.close();
}

function openLegacyDb(): Database {
  const dir = mkdtempSync(join(tmpdir(), "conveyor-migrate-"));
  dirs.push(dir);
  const path = join(dir, "conveyor.db");
  writeLegacyDb(path);
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

  test("adds timings_json to the migrated jobs table", () => {
    const db = openLegacyDb();
    expect(namesOf(db, "PRAGMA table_info(jobs)")).toContain("timings_json");
  });
});

describe("openDb legacy printers and profiles columns", () => {
  test("adds allowed_generators_json to a legacy printer and keeps its row", () => {
    const db = openLegacyDb();
    expect(namesOf(db, "PRAGMA table_info(printers)")).toContain("allowed_generators_json");
    expect(dbGetPrinter(db, "printer-a")).toEqual({
      id: "printer-a",
      transportId: "moonraker",
      name: "Legacy A",
      address: "http://a",
      secrets: undefined,
      allowedGenerators: undefined,
    });
    dbUpsertPrinter(db, {
      id: "printer-a",
      transportId: "moonraker",
      name: "Legacy A",
      address: "http://a",
      allowedGenerators: ["gen"],
    });
    expect(dbGetPrinter(db, "printer-a")?.allowedGenerators).toEqual(["gen"]);
  });

  test("adds the Orca and Prusa content columns to a legacy profile and keeps its row", () => {
    const db = openLegacyDb();
    expect(namesOf(db, "PRAGMA table_info(profiles)")).toEqual(
      expect.arrayContaining([
        "orca_machine_json",
        "orca_process_json",
        "orca_filament_json",
        "prusa_ini",
      ]),
    );
    expect(dbGetProfile(db, "profile-a")).toEqual({
      id: "profile-a",
      slicerId: "orca",
      name: "Legacy PLA",
      path: "/profiles/a",
      gcodeFlavor: "klipper",
    });
    const orca = { machine: "{}", process: "{}", filament: "{}" };
    expect(dbSaveOrcaProfileDocuments(db, "profile-a", orca)).toBe(true);
    expect(dbGetOrcaProfileDocuments(db, "profile-a")).toEqual(orca);
    expect(dbSavePrusaProfileContent(db, "profile-a", { config: "a = 1" })).toBe(true);
    expect(dbGetPrusaProfileContent(db, "profile-a")).toEqual({ config: "a = 1" });
  });
});
