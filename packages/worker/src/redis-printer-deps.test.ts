import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dbRecordJob, openDb } from "@conveyor/shared/db";
import { redisPrinterDeps, startRedisWorker } from "./index";

const dir = mkdtempSync(join(tmpdir(), "conveyor-redis-printer-deps-"));
const db = openDb(join(dir, "conveyor.db"));
afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
for (const [id, at] of [
  ["older", 1],
  ["newer", 2],
] as const) {
  dbRecordJob(db, {
    id,
    generatorId: "g",
    printerId: "p1",
    profileId: "x",
    state: "done",
  });
  db.run("UPDATE jobs SET updated_at = ? WHERE id = ?", [at, id]);
}

const keepFor = (env: Record<string, string | undefined>) =>
  redisPrinterDeps(() => db, env).printerFilesToKeep?.("p1", "now");

test("the Redis worker keeps the printer files CONVEYOR_PRINTER_KEEP_FILES names", () => {
  expect(keepFor({})).toEqual(["conveyor-now.gcode"]);
  expect(keepFor({ CONVEYOR_PRINTER_KEEP_FILES: "2" })).toEqual([
    "conveyor-now.gcode",
    "conveyor-newer.gcode",
  ]);
  expect(keepFor({ CONVEYOR_PRINTER_KEEP_FILES: "0" })).toEqual([]);
});

test("the Redis worker refuses a bad CONVEYOR_PRINTER_KEEP_FILES before it connects", () => {
  const connected: string[] = [];
  const start = () =>
    startRedisWorker(
      { CONVEYOR_PRINTER_KEEP_FILES: "-1", DB_PATH: join(dir, "conveyor.db"), DATA_DIR: dir },
      {
        connect: (url) => {
          connected.push(url);
          throw new Error("connected");
        },
        makeDir: async () => undefined,
        queue: "unused",
      },
    );
  expect(start).toThrow("CONVEYOR_PRINTER_KEEP_FILES must be a whole number, 0 or more, got -1");
  expect(connected).toEqual([]);
});
