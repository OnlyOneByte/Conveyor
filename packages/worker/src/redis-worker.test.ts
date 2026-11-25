import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ACTIVE_JOBS_KEY, jobSnapshotKey, parseStatusEvent, publishStatus } from "@conveyor/shared";
import { dbGetJob, openDb } from "@conveyor/shared/db";
import { Queue } from "bullmq";
import { Redis, type RedisOptions } from "ioredis";
import { type RedisWorker, type RedisWorkerDeps, startRedisWorker } from "./index";
import { startWorker } from "./main";
import { ORPHAN_REASON, REAPER_INTERVAL_MS } from "./redis-reaper";

const url = process.env.REDIS_URL;
if (!url && process.env.CI)
  throw new Error("REDIS_URL must be set in CI for the Redis worker tests");

const NO_SUBSCRIBE_USER = `conveyor-test-nosub-${randomUUID()}`;
const NO_SUBSCRIBE_PASSWORD = randomUUID();
const KEY_PREFIX = `test-redis-worker-${randomUUID()}:`;

const VALID = {
  generator: { id: "gridfinity", params: { gridX: 1, gridY: 1, heightUnits: 3 } },
  printerId: "missing-printer",
  profileId: "orca/klipper-pla-0.2",
};

let dir = "";
let admin: Redis | undefined;
let running: RedisWorker | undefined;
let queue: Queue | undefined;
const opened: Redis[] = [];
const snapshots: string[] = [];

function redisUrl(): string {
  if (!url) throw new Error("no redis");
  return url;
}

function noSubscribeUrl(): string {
  const parsed = new URL(redisUrl());
  parsed.username = NO_SUBSCRIBE_USER;
  parsed.password = NO_SUBSCRIBE_PASSWORD;
  return parsed.toString();
}

function track(target: string, options: RedisOptions = { keyPrefix: KEY_PREFIX }): Redis {
  const client = new Redis(target, options);
  opened.push(client);
  return client;
}

function deps(name: string, over: Partial<RedisWorkerDeps> = {}): RedisWorkerDeps {
  return {
    connect: (target, options) => track(target, options),
    makeDir: (path) => mkdir(path, { recursive: true }),
    queue: name,
    ...over,
  };
}

async function run(data: unknown, over: Partial<RedisWorkerDeps> = {}) {
  const name = `test-redis-worker-${randomUUID()}`;
  const env = { REDIS_URL: redisUrl(), DB_PATH: join(dir, "conveyor.db"), DATA_DIR: dir };
  running = startRedisWorker(env, deps(name, over));
  queue = new Queue(name, { connection: { url: redisUrl() } });
  const jobId = `test-${randomUUID()}`;
  snapshots.push(jobId);
  await queue.add("job", data, { jobId });
  const db = openDb(env.DB_PATH);
  const deadline = Date.now() + 4_000;
  while (dbGetJob(db, jobId)?.state !== "failed") {
    if (Date.now() > deadline) throw new Error(`job ${jobId} was never recorded failed`);
    await Bun.sleep(25);
  }
  await running.stop();
  running = undefined;
  const snapshot = parseStatusEvent(await (admin ?? track(redisUrl())).get(jobSnapshotKey(jobId)));
  return { row: dbGetJob(db, jobId), snapshot };
}

beforeAll(async () => {
  if (!url) return;
  admin = new Redis(url, { keyPrefix: KEY_PREFIX });
  await admin.acl(
    "SETUSER",
    NO_SUBSCRIBE_USER,
    "on",
    `>${NO_SUBSCRIBE_PASSWORD}`,
    "~*",
    "&*",
    "+@all",
    "-subscribe",
  );
});

afterEach(async () => {
  await running?.stop();
  running = undefined;
  await queue?.obliterate({ force: true });
  await queue?.close();
  queue = undefined;
  for (const client of opened.splice(0)) client.disconnect();
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = mkdtempSync(join(tmpdir(), "conveyor-redis-worker-"));
});

afterAll(async () => {
  rmSync(dir, { recursive: true, force: true });
  if (!admin) return;
  await admin.acl("DELUSER", NO_SUBSCRIBE_USER);
  if (snapshots.length) await admin.del(...snapshots.map(jobSnapshotKey));
  admin.disconnect();
});

dir = mkdtempSync(join(tmpdir(), "conveyor-redis-worker-"));

describe.skipIf(!url)("the Redis worker before the pipeline (real Redis)", () => {
  test("a work dir it cannot create leaves a failed job in history", async () => {
    const { row, snapshot } = await run(VALID, {
      makeDir: () => Promise.reject(new Error("EACCES: permission denied, mkdir '/data/x'")),
    });
    expect(row).toMatchObject({
      state: "failed",
      request: { generator: { id: "gridfinity" }, printerId: "missing-printer" },
      error: { stage: "generator", reason: "EACCES: permission denied, mkdir '/data/x'" },
    });
    expect(snapshot?.state).toBe("failed");
  });

  test("an invalid payload leaves a failed job in history with what it could read", async () => {
    const { row, snapshot } = await run({ generator: { id: "gridfinity" }, printerId: 7 });
    expect(row).toMatchObject({
      state: "failed",
      request: { generator: { id: "gridfinity" }, printerId: "unknown", profileId: "unknown" },
      error: { stage: "generator", reason: expect.stringContaining("invalid job payload") },
    });
    expect(snapshot?.state).toBe("failed");
  });

  test("a control subscribe that fails is recorded and its connection is closed", async () => {
    const controls: Redis[] = [];
    let plain = 0;
    const { row } = await run(VALID, {
      connect: (target, options) => {
        if (options || plain++ === 0) return track(target, options);
        const control = track(noSubscribeUrl());
        controls.push(control);
        return control;
      },
    });
    expect(row).toMatchObject({
      state: "failed",
      error: { stage: "generator", reason: expect.stringContaining("NOPERM") },
    });
    expect(controls).toHaveLength(1);
    expect(controls.map((control) => control.status)).toEqual(["end"]);
  });

  test("a job for an unknown printer fails in the pipeline and is recorded once", async () => {
    const { row, snapshot } = await run(VALID);
    expect(row).toMatchObject({ state: "failed", request: { printerId: "missing-printer" } });
    expect(snapshot?.state).toBe("failed");
  });
});

describe.skipIf(!url)("the worker entry point on the Redis queue (real Redis)", () => {
  test("starts a Redis worker and stops it", async () => {
    const started = await startWorker({
      CONVEYOR_QUEUE: "redis",
      REDIS_URL: redisUrl(),
      DB_PATH: join(dir, "conveyor.db"),
      DATA_DIR: dir,
    });
    expect(started.mode).toBe("redis");
    await started.stop();
  });
});

describe.skipIf(!url)("the Redis worker's double-print guard (real Redis)", () => {
  test("never re-runs a stalled job, reaps an orphan at start, and stops the reaper on stop()", async () => {
    const name = `test-redis-worker-${randomUUID()}`;
    const env = { REDIS_URL: redisUrl(), DB_PATH: join(dir, "conveyor.db"), DATA_DIR: dir };
    const orphan = `test-orphan-${randomUUID()}`;
    snapshots.push(orphan);
    const redis = admin ?? track(redisUrl());
    await publishStatus(redis, {
      jobId: orphan,
      state: "printing",
      stage: "transport",
      at: Date.now(),
    });
    const intervals = spyOn(globalThis, "setInterval");
    const cleared = spyOn(globalThis, "clearInterval");
    const closed = spyOn(Queue.prototype, "close");
    try {
      running = startRedisWorker(env, deps(name));
      const reaperCall = intervals.mock.calls.findIndex(([, ms]) => ms === REAPER_INTERVAL_MS);
      const reaperTimer = intervals.mock.results[reaperCall]?.value;
      expect(reaperTimer).toBeDefined();
      expect(running.worker.opts.maxStalledCount).toBe(0);
      const db = openDb(env.DB_PATH);
      const deadline = Date.now() + 4_000;
      while (!dbGetJob(db, orphan)) {
        if (Date.now() > deadline) throw new Error(`orphan ${orphan} was never reaped`);
        await Bun.sleep(25);
      }
      expect(dbGetJob(db, orphan)).toMatchObject({
        state: "failed",
        error: { reason: ORPHAN_REASON },
      });
      expect(await redis.sismember(ACTIVE_JOBS_KEY, orphan)).toBe(0);
      const lookups = closed.mock.contexts.length;
      await running.stop();
      running = undefined;
      expect(cleared.mock.calls.some(([timer]) => timer === reaperTimer)).toBe(true);
      const closedNames = closed.mock.contexts
        .slice(lookups)
        .flatMap((queue) => (queue instanceof Queue ? [queue.name] : []));
      expect(closedNames).toContain(name);
    } finally {
      intervals.mockRestore();
      cleared.mockRestore();
      closed.mockRestore();
    }
  });
});
