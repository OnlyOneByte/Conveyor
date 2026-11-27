import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dbGetJob, dbUpsertPrinter, openDb } from "@conveyor/shared/db";
import { holdPrinter, releasePrinterHold } from "@conveyor/shared/queue";
import { type Job, Queue } from "bullmq";
import { Redis } from "ioredis";
import { dropsItsRedisKeys } from "../../shared/test/helpers/index.ts";
import { type RedisWorker, startRedisWorker } from "./index";

const url = process.env.REDIS_URL;
if (!url && process.env.CI)
  throw new Error("REDIS_URL must be set in CI for the Redis hold-at-claim tests");

const REQUEST = {
  generator: { id: "gridfinity", params: { gridX: 1, gridY: 1, heightUnits: 3 } },
  printerId: "garage",
  profileId: "orca/klipper-pla-0.2",
};
const STARTED = "the job started after its printer's hold was released";

let dir = "";
let running: RedisWorker | undefined;
let queue: Queue | undefined;
const opened: Redis[] = [];

afterEach(async () => {
  await running?.stop();
  running = undefined;
  await queue?.obliterate({ force: true });
  await queue?.close();
  queue = undefined;
  for (const client of opened.splice(0)) client.disconnect();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

async function until(check: () => Promise<boolean>, what: string, ms = 4_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`${what} within ${ms} ms`);
    await Bun.sleep(25);
  }
}

describe.skipIf(!url)("a hold placed after the API's 409 check (real Redis)", () => {
  test("keeps the job queued, without modelling it, until Release hold", async () => {
    if (!url) return;
    dir = mkdtempSync(join(tmpdir(), "conveyor-redis-hold-"));
    const env = { REDIS_URL: url, DB_PATH: join(dir, "conveyor.db"), DATA_DIR: dir };
    const db = openDb(env.DB_PATH);
    dbUpsertPrinter(db, { id: "garage", transportId: "tr", name: "Garage", address: "10.0.0.9" });
    const name = `test-redis-hold-${randomUUID()}`;
    queue = new Queue(name, { connection: { url } });
    const jobId = `test-${randomUUID()}`;
    const job: Job = await queue.add("job", REQUEST, { jobId });
    holdPrinter(db, { printerId: "garage", jobId: "earlier", reason: "may have started", at: 1 });
    const made: string[] = [];
    running = startRedisWorker(env, {
      queue: name,
      connect: (target, options) => {
        const client = new Redis(target, options ?? {});
        opened.push(client);
        return client;
      },
      makeDir: async (path) => {
        made.push(path);
        throw new Error(STARTED);
      },
    });

    await until(async () => (await job.getState()) === "delayed", "the job never waited");
    expect(made).toEqual([]);
    expect(dbGetJob(db, jobId)).toBeNull();
    expect(await queue.getJob(jobId).then((j) => j?.attemptsMade)).toBe(0);

    await (await queue.getJob(jobId))?.promote();
    await until(async () => (await job.getState()) === "delayed", "a recheck didn't wait again");
    expect(made).toEqual([]);

    releasePrinterHold(db, "garage");
    await (await queue.getJob(jobId))?.promote();
    await until(async () => dbGetJob(db, jobId)?.state === "failed", "the job never ran");
    expect(made).toEqual([join(dir, jobId)]);
    expect(dbGetJob(db, jobId)).toMatchObject({ error: { reason: STARTED } });
  });
});

dropsItsRedisKeys();
