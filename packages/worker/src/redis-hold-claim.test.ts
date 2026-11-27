import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ACTIVE_JOBS_KEY, jobCancelKey, jobSnapshotKey, parseStatusEvent } from "@conveyor/shared";
import { dbGetJob, dbUpsertPrinter, openDb } from "@conveyor/shared/db";
import { holdPrinter, releasePrinterHold } from "@conveyor/shared/queue";
import { type Job, Queue } from "bullmq";
import { Redis } from "ioredis";
import { dropsItsRedisKeys } from "../../shared/test/helpers/index.ts";
import { holdWaitMessage } from "./hold-wait";
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
const HOLD = "may have started";

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

async function heldJob() {
  if (!url) throw new Error("no redis");
  dir = mkdtempSync(join(tmpdir(), "conveyor-redis-hold-"));
  const env = { REDIS_URL: url, DB_PATH: join(dir, "conveyor.db"), DATA_DIR: dir };
  const db = openDb(env.DB_PATH);
  dbUpsertPrinter(db, { id: "garage", transportId: "tr", name: "Garage", address: "10.0.0.9" });
  const name = `test-redis-hold-${randomUUID()}`;
  queue = new Queue(name, { connection: { url } });
  const jobId = `test-${randomUUID()}`;
  const job: Job = await queue.add("job", REQUEST, { jobId });
  holdPrinter(db, { printerId: "garage", jobId: "earlier", reason: HOLD, at: 1 });
  const made: string[] = [];
  const admin = new Redis(url);
  opened.push(admin);
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
  const snapshot = async () => parseStatusEvent(await admin.get(jobSnapshotKey(jobId)));
  const promote = async () => (await queue?.getJob(jobId))?.promote();
  await until(async () => (await job.getState()) === "delayed", "the job never waited");
  return { db, admin, job, jobId, made, snapshot, promote, connections: () => opened.length };
}

describe.skipIf(!url)("a hold placed after the API's 409 check (real Redis)", () => {
  test("keeps the job queued, shown waiting and unmodelled, until Release hold", async () => {
    const { db, admin, job, jobId, made, snapshot, promote, connections } = await heldJob();
    expect(made).toEqual([]);
    const delay = (await queue?.getJob(jobId))?.delay ?? 0;
    expect(delay).toBeGreaterThan(4_000);
    expect(delay).toBeLessThanOrEqual(5_000);
    const opened = connections();
    expect(dbGetJob(db, jobId)).toBeNull();
    expect(await queue?.getJob(jobId).then((j) => j?.attemptsMade)).toBe(0);
    const shown = await snapshot();
    expect(shown).toMatchObject({ state: "queued", message: holdWaitMessage(HOLD) });
    expect(await admin.sismember(ACTIVE_JOBS_KEY, jobId)).toBe(1);

    await promote();
    await until(async () => (await job.getState()) === "delayed", "a recheck didn't wait again");
    expect(made).toEqual([]);
    expect((await snapshot())?.at).toBe(shown?.at);
    expect(connections()).toBe(opened);

    releasePrinterHold(db, "garage");
    await promote();
    await until(async () => dbGetJob(db, jobId)?.state === "failed", "the job never ran");
    expect(made).toEqual([join(dir, jobId)]);
    expect(dbGetJob(db, jobId)).toMatchObject({ error: { reason: STARTED } });
  });

  test("a cancel that lands while it waits settles it canceled at the next recheck", async () => {
    const { db, admin, job, jobId, made, snapshot, promote } = await heldJob();
    await admin.set(jobCancelKey(jobId), "1", "EX", 60);
    await promote();
    await until(async () => (await job.getState()) === "completed", "the cancel never settled");
    expect((await snapshot())?.state).toBe("canceled");
    expect(dbGetJob(db, jobId)).toMatchObject({ state: "canceled" });
    expect(made).toEqual([]);
    await admin.del(jobCancelKey(jobId));
  });
});

dropsItsRedisKeys();
