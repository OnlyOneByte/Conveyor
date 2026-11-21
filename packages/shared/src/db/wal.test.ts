import { Database, SQLiteError } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enableWal, WAL_RETRY } from "./wal";

const dirs: string[] = [];
const open: Database[] = [];

function freshPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "conveyor-wal-"));
  dirs.push(dir);
  return join(dir, "conveyor.db");
}

function track(db: Database): Database {
  open.push(db);
  return db;
}

function thrownBy(run: () => void): unknown {
  try {
    run();
  } catch (err) {
    return err;
  }
  return undefined;
}

function lockedDatabase(): { path: string; db: Database } {
  const path = freshPath();
  const holder = track(new Database(path, { create: true }));
  holder.exec("CREATE TABLE t (x)");
  holder.exec("BEGIN IMMEDIATE");
  return { path, db: track(new Database(path)) };
}

afterEach(() => {
  for (const db of open.splice(0)) db.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("enableWal", () => {
  test("defaults to 50 attempts 100 ms apart with a blocking sleep", () => {
    expect(WAL_RETRY).toEqual({ attempts: 50, delayMs: 100, sleep: Bun.sleepSync });
  });

  test.each([
    [3, "3 attempts", [7, 7]],
    [1, "1 attempt", []],
  ])(
    "gives up on the last of %d allowed attempts naming the path and count and keeps the busy cause",
    (attempts, counted, expectedSleeps) => {
      const { path, db } = lockedDatabase();
      const sleeps: number[] = [];

      const err = thrownBy(() =>
        enableWal(db, { attempts, delayMs: 7, sleep: (ms) => sleeps.push(ms) }),
      );

      expect(err instanceof Error && err.message).toBe(
        `could not enable WAL on ${path} after ${counted}: database is locked`,
      );
      expect(err instanceof Error && err.cause instanceof SQLiteError && err.cause.code).toBe(
        "SQLITE_BUSY",
      );
      expect(sleeps).toEqual(expectedSleeps);
    },
  );

  test("rethrows a non-busy error on the first attempt without retrying", () => {
    const path = freshPath();
    new Database(path, { create: true }).close();
    const db = track(new Database(path, { readonly: true }));
    const sleeps: number[] = [];

    const err = thrownBy(() =>
      enableWal(db, { attempts: 3, delayMs: 7, sleep: (ms) => sleeps.push(ms) }),
    );

    expect(err instanceof SQLiteError && err.code).toBe("SQLITE_READONLY");
    expect(sleeps).toEqual([]);
  });

  test("switches an unlocked database to WAL", () => {
    const db = track(new Database(freshPath(), { create: true }));

    enableWal(db, { attempts: 3, delayMs: 7, sleep: () => {} });

    expect(db.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get()).toEqual({
      journal_mode: "wal",
    });
  });
});
