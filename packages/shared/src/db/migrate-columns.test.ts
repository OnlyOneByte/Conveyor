import type { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeLegacyStationDb } from "../../test/helpers/legacy-db.ts";
import { holdWriteLock } from "../../test/helpers/queue.ts";
import {
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

describe("openDb migration lock", () => {
  test("waits for a process that adds a queue column first instead of failing on it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "conveyor-migrate-"));
    dirs.push(dir);
    const path = join(dir, "conveyor.db");
    openDb(path).exec("ALTER TABLE jobs DROP COLUMN progress");
    openDb(join(dir, "other.db"));
    const holder = await holdWriteLock(path, "ALTER TABLE jobs ADD COLUMN progress REAL");
    expect(namesOf(openDb(path), "PRAGMA table_info(jobs)")).toContain("progress");
    expect(await holder.exited).toBe(0);
  });
});

describe("openDb legacy printers and profiles columns", () => {
  test("adds allowed_generators_json and the check times to a legacy printer and keeps its row", () => {
    const db = openLegacyDb();
    expect(namesOf(db, "PRAGMA table_info(printers)")).toEqual(
      expect.arrayContaining(["allowed_generators_json", "last_seen_at", "last_checked_at"]),
    );
    expect(dbGetPrinter(db, "printer-a")).toEqual({
      id: "printer-a",
      transportId: "moonraker",
      name: "Legacy A",
      address: "http://a",
      hasSecrets: false,
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
