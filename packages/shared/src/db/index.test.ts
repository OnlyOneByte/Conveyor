import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  dbDeletePrinter,
  dbDeleteProfile,
  dbGetJob,
  dbListPrinters,
  dbListProfiles,
  dbResolveJobTarget,
  openDb,
} from "./index";
import { DEFAULT_PRINTERS, DEFAULT_PROFILES } from "./seed";

const dirs: string[] = [];

function freshPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "conveyor-db-"));
  dirs.push(dir);
  return join(dir, "conveyor.db");
}

function reopen(path: string) {
  openDb(freshPath()).close();
  return openDb(path);
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("openDb seeding", () => {
  test("seeds the default catalog on a fresh database", () => {
    const db = openDb(freshPath());
    expect(dbListPrinters(db)).toHaveLength(DEFAULT_PRINTERS.length);
    expect(dbListProfiles(db)).toHaveLength(DEFAULT_PROFILES.length);
  });

  test("reopens cleanly after every printer is deleted and keeps zero printers", () => {
    const path = freshPath();
    const db = openDb(path);
    for (const p of dbListPrinters(db)) dbDeletePrinter(db, p.id);

    const reopened = reopen(path);
    expect(dbListPrinters(reopened)).toEqual([]);
    expect(dbListProfiles(reopened)).toHaveLength(DEFAULT_PROFILES.length);
    expect(dbResolveJobTarget(reopened, DEFAULT_PRINTERS[0].id, DEFAULT_PROFILES[0].id)).toBeNull();
  });

  test("never reseeds after every printer and profile is deleted", () => {
    const path = freshPath();
    const db = openDb(path);
    for (const p of dbListPrinters(db)) dbDeletePrinter(db, p.id);
    for (const p of dbListProfiles(db)) dbDeleteProfile(db, p.id);

    const reopened = reopen(path);
    expect(dbListPrinters(reopened)).toEqual([]);
    expect(dbListProfiles(reopened)).toEqual([]);
  });

  test("recovers a database already left with profiles but no printers", () => {
    const path = freshPath();
    const db = openDb(path);
    for (const p of dbListPrinters(db)) dbDeletePrinter(db, p.id);
    db.exec("DROP TABLE meta");

    const reopened = reopen(path);
    expect(dbListPrinters(reopened)).toEqual([]);
    expect(dbListProfiles(reopened)).toHaveLength(DEFAULT_PROFILES.length);
  });

  test("boots an old database with printers but no profiles without seeding", () => {
    const path = freshPath();
    const db = openDb(path);
    for (const p of dbListProfiles(db)) dbDeleteProfile(db, p.id);
    db.exec("DROP TABLE meta");

    const reopened = reopen(path);
    expect(
      dbListPrinters(reopened)
        .map((p) => p.id)
        .sort(),
    ).toEqual(DEFAULT_PRINTERS.map((p) => p.id).sort());
    expect(dbListProfiles(reopened)).toEqual([]);
  });

  test("three processes opening one new database at once all succeed and seed once", async () => {
    const path = freshPath();
    const startAt = Date.now() + 1500;
    const script = `import { openDb } from ${JSON.stringify(join(import.meta.dir, "index.ts"))};
while (Date.now() < ${startAt});
openDb(${JSON.stringify(path)});`;
    const procs = [0, 1, 2].map(() =>
      Bun.spawn([process.execPath, "-e", script], { stdout: "ignore", stderr: "pipe" }),
    );
    const results = await Promise.all(
      procs.map(async (p) => ({
        code: await p.exited,
        stderr: await new Response(p.stderr).text(),
      })),
    );
    expect(results).toEqual([0, 1, 2].map(() => ({ code: 0, stderr: "" })));

    const db = reopen(path);
    expect(dbListPrinters(db)).toHaveLength(DEFAULT_PRINTERS.length);
    expect(dbListProfiles(db)).toHaveLength(DEFAULT_PROFILES.length);
  });
});

function writeLegacyDb(path: string): void {
  const legacy = new Database(path, { create: true });
  legacy.exec(`CREATE TABLE stations (id TEXT PRIMARY KEY, printer_id TEXT, profile_id TEXT);
CREATE TABLE jobs (
  id TEXT PRIMARY KEY, generator_id TEXT NOT NULL, params_json TEXT, station_id TEXT,
  state TEXT NOT NULL, stage TEXT, error_json TEXT, model_path TEXT, gcode_path TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
INSERT INTO stations VALUES ('st-a', 'printer-a', 'profile-a'), ('st-b', 'printer-b', 'profile-b');
INSERT INTO jobs VALUES
  ('job-a', 'gen', NULL, 'st-a', 'done', NULL, NULL, NULL, NULL, 1, 1),
  ('job-b', 'gen', NULL, 'st-b', 'done', NULL, NULL, NULL, NULL, 2, 2),
  ('job-gone', 'gen', NULL, 'st-deleted', 'failed', NULL, NULL, NULL, NULL, 3, 3);`);
  legacy.close();
}

describe("openDb legacy station migration", () => {
  test("backfills each job's printer and profile from its station", () => {
    const path = freshPath();
    writeLegacyDb(path);
    const db = openDb(path);
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
    const path = freshPath();
    writeLegacyDb(path);
    const db = openDb(path);
    expect(dbGetJob(db, "job-gone")?.request).toMatchObject({ printerId: "", profileId: "" });
  });

  test("drops the stations table and the station_id column", () => {
    const path = freshPath();
    writeLegacyDb(path);
    const db = openDb(path);
    const tables = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all();
    expect(tables.map((t) => t.name)).not.toContain("stations");
    const columns = db.query<{ name: string }, []>("PRAGMA table_info(jobs)").all();
    expect(columns.map((c) => c.name)).not.toContain("station_id");
  });
});
