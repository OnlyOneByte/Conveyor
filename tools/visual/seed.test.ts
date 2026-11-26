import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as Db from "../../packages/shared/src/db/index.ts";
import { SEEDED_ENGINE_LOG, SEEDED_JOBS, seedHistory } from "./seed.ts";

test("seeded jobs get distinct times, so history lists them in one order", async () => {
  const dir = await mkdtemp(join(tmpdir(), "conveyor-seed-"));
  const env = { DB_PATH: join(dir, "conveyor.db"), DATA_DIR: dir };
  try {
    await seedHistory(resolve(import.meta.dir, "../.."), env);
    const conn = Db.openDb(env.DB_PATH, env);
    const listed = Db.dbListJobs(conn);
    conn.close();
    expect(listed.map((job) => job.id)).toEqual(SEEDED_JOBS.map((job) => job.id).reverse());
    const times = listed.map((job) => job.updatedAt);
    expect(new Set(times).size).toBe(SEEDED_JOBS.length);
    expect(listed.map((job) => job.createdAt)).toEqual(times);
    expect(await readFile(join(dir, "seed-failed", "engine.log"), "utf8")).toBe(SEEDED_ENGINE_LOG);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
