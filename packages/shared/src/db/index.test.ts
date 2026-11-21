import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  dbDeletePrinter,
  dbDeleteProfile,
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
