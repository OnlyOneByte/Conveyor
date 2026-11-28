import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootApi } from "../test/helpers/booted-api.ts";

const root = mkdtempSync(join(tmpdir(), "conveyor-data-modes-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const modeOf = (path: string) => (statSync(path).mode & 0o777).toString(8);
const DB_FILES = ["conveyor.db", "conveyor.db-wal", "conveyor.db-shm"];

async function firstStart(data: string, whileRunning: () => void = () => {}): Promise<void> {
  const api = await bootApi(root, {
    CONVEYOR_AUTH: "disabled",
    CONVEYOR_QUEUE: "sqlite",
    CONVEYOR_QUEUE_UNSTABLE: "1",
    DB_PATH: join(data, "conveyor.db"),
    DATA_DIR: data,
  });
  try {
    whileRunning();
  } finally {
    await api.stop();
  }
}

test("a first start in an empty data dir creates the database, WAL and SHM owner-only", async () => {
  const data = join(root, "empty");
  mkdirSync(data, { mode: 0o755 });
  let modes: string[][] = [];
  await firstStart(data, () => {
    modes = DB_FILES.map((file) => [file, modeOf(join(data, file))]);
  });
  expect(modes).toEqual(DB_FILES.map((file) => [file, "600"]));
});

test("a first start with no data dir creates it owner-only", async () => {
  const data = join(root, "missing");
  await firstStart(data);
  expect(modeOf(data)).toBe("700");
  expect(modeOf(join(data, "conveyor.db"))).toBe("600");
});
