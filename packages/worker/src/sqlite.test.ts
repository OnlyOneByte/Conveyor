import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dbUpsertPrinter, openDb } from "@conveyor/shared/db";
import { sqliteBase, startSqliteWorker } from "./sqlite";

const dir = mkdtempSync(join(tmpdir(), "conveyor-worker-sqlite-"));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("starts and stops on the database DB_PATH names, resolving printers from it", async () => {
  const path = join(dir, "conveyor.db");
  const worker = startSqliteWorker({ DB_PATH: path, DATA_DIR: dir }, 1);
  const db = openDb(path);
  dbUpsertPrinter(db, { id: "p1", transportId: "tr", name: "P1", address: "10.0.0.9" });
  const base = sqliteBase(db);
  expect(await base.resolvePrinter("p1")).toMatchObject({ id: "p1", address: "10.0.0.9" });
  expect(base.printerFilesToKeep?.("p1", "j")).toEqual(["conveyor-j.gcode"]);
  expect(sqliteBase(db, 0).printerFilesToKeep?.("p1", "j")).toEqual([]);
  await expect(base.resolvePrinter("missing")).rejects.toThrow("unknown printer missing");
  expect(
    base.resolveJobTarget({ generator: { id: "gen" }, printerId: "p1", profileId: "x" }),
  ).toBeNull();
  await worker.stop();
  db.close();
});
