import type { Database } from "bun:sqlite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ACTIVE_JOBS_KEY,
  type JobRequest,
  jobSnapshotKey,
  parseStatusEvent,
  publishStatus,
} from "@conveyor/shared";
import {
  dbClaimRetry,
  dbGetJob,
  dbListNeedsYou,
  dbRecordJob,
  dbRetriedBy,
  openDb,
} from "@conveyor/shared/db";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import {
  createRedisReaper,
  ORPHAN_REASON,
  type RedisReaper,
  type RedisReaperDeps,
  redisReaperDeps,
  startRedisReaper,
} from "./redis-reaper.js";

const url = process.env.REDIS_URL;
if (!url && process.env.CI)
  throw new Error("REDIS_URL must be set in CI for the Redis reaper tests");

const request: JobRequest = {
  generator: { id: "gridfinity", params: { gridX: 2 } },
  printerId: "klipper-garage",
  profileId: "orca/klipper-pla-0.2",
};

describe.skipIf(!url)("the Redis reaper", () => {
  let redis: Redis;
  let queue: Queue<JobRequest>;
  let queueName = "";
  let db: Database;
  let dir = "";
  const mine = new Set<string>();
  let reaper: RedisReaper;

  const connect = () => new Redis(url ?? "", { maxRetriesPerRequest: null });
  const snapshotOf = async (id: string) => parseStatusEvent(await redis.get(jobSnapshotKey(id)));
  const deps = (): RedisReaperDeps => ({
    ...redisReaperDeps(redis, queue, () => {}),
    db: () => db,
    activeIds: async () => (await redis.smembers(ACTIVE_JOBS_KEY)).filter((id) => mine.has(id)),
  });
  const track = (id: string) => {
    mine.add(id);
    return id;
  };

  beforeAll(() => {
    redis = connect();
  });

  afterAll(() => {
    redis.disconnect();
  });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "conveyor-redis-reaper-"));
    db = openDb(join(dir, "conveyor.db"));
    queueName = `reaper-${randomUUID()}`;
    queue = new Queue<JobRequest>(queueName, { connection: connect() });
    mine.clear();
    reaper = createRedisReaper(deps());
  });

  afterEach(async () => {
    if (mine.size) {
      await redis.srem(ACTIVE_JOBS_KEY, ...mine);
      await redis.del(...[...mine].map(jobSnapshotKey));
    }
    await queue.obliterate({ force: true });
    await queue.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function stateOf(id: string, wanted: string): Promise<void> {
    for (let i = 0; i < 400; i++) {
      if ((await (await queue.getJob(id))?.getState()) === wanted) return;
      await Bun.sleep(25);
    }
    throw new Error(`job ${id} never reached ${wanted}`);
  }

  test("a worker killed mid-job is recorded failed once BullMQ gives up on it", async () => {
    const id = track(randomUUID());
    const options = { lockDuration: 400, stalledInterval: 200, maxStalledCount: 0 };
    let started = false;
    const doomed = new Worker<JobRequest>(
      queueName,
      async (job) => {
        await publishStatus(redis, {
          jobId: job.id ?? "",
          state: "slicing",
          stage: "slicer",
          at: Date.now(),
        });
        started = true;
        await new Promise(() => {});
      },
      { ...options, connection: connect() },
    );
    await queue.add("job", request, { jobId: id });
    while (!started) await Bun.sleep(20);
    await doomed.close(true);
    const checker = new Worker<JobRequest>(
      queueName,
      async () => {
        throw new Error("the stalled job must not run again");
      },
      { ...options, connection: connect() },
    );
    try {
      await stateOf(id, "failed");
      await reaper.sweep();
    } finally {
      await checker.close();
    }
    expect(dbGetJob(db, id)).toMatchObject({
      state: "failed",
      stage: "slicer",
      error: { stage: "slicer", reason: ORPHAN_REASON },
      request,
    });
    expect(await snapshotOf(id)).toMatchObject({ state: "failed", stage: "slicer" });
    expect(await redis.sismember(ACTIVE_JOBS_KEY, id)).toBe(0);
    expect(dbListNeedsYou(db).map((job) => job.id)).toContain(id);
  }, 20_000);

  test("a running job that is gone from BullMQ is recorded failed, with what is known of it", async () => {
    const id = track(randomUUID());
    await publishStatus(redis, {
      jobId: id,
      state: "printing",
      stage: "transport",
      at: Date.now(),
    });
    await reaper.sweep();
    expect(dbGetJob(db, id)).toMatchObject({
      state: "failed",
      error: { stage: "transport", reason: ORPHAN_REASON },
      request: { generator: { id: "unknown" }, printerId: "", profileId: "" },
    });
    expect(await redis.sismember(ACTIVE_JOBS_KEY, id)).toBe(0);
  });

  test("a job BullMQ still has waiting or active is left alone", async () => {
    const id = track(randomUUID());
    await queue.add("job", request, { jobId: id });
    await publishStatus(redis, { jobId: id, state: "queued", at: Date.now() });
    await reaper.sweep();
    expect(dbGetJob(db, id)).toBeNull();
    expect(await redis.sismember(ACTIVE_JOBS_KEY, id)).toBe(1);
  });

  test("a retry that dies gives its original failure back to Needs-you", async () => {
    const original = randomUUID();
    const retry = track(randomUUID());
    dbRecordJob(db, {
      id: original,
      generatorId: "gridfinity",
      printerId: "klipper-garage",
      profileId: "orca/klipper-pla-0.2",
      state: "failed",
      error: { stage: "transport", reason: "printer went offline" },
    });
    expect(dbClaimRetry(db, original, retry)).toBe(true);
    expect(dbListNeedsYou(db).map((job) => job.id)).not.toContain(original);
    await publishStatus(redis, { jobId: retry, state: "slicing", stage: "slicer", at: Date.now() });
    await reaper.sweep();
    expect(dbRetriedBy(db, original)).toBeNull();
    expect(dbGetJob(db, retry)?.state).toBe("failed");
    const needsYou = dbListNeedsYou(db).map((job) => job.id);
    expect(needsYou).toContain(original);
    expect(needsYou).not.toContain(retry);
  });

  test("a retry claim whose retry was never queued is released on the second sweep, and a queued one is kept", async () => {
    const [lost, kept] = [randomUUID(), randomUUID()];
    const [lostRetry, keptRetry] = [randomUUID(), randomUUID()];
    for (const id of [lost, kept])
      dbRecordJob(db, {
        id,
        generatorId: "gridfinity",
        printerId: "klipper-garage",
        profileId: "orca/klipper-pla-0.2",
        state: "failed",
        error: { stage: "slicer", reason: "boom" },
      });
    dbClaimRetry(db, lost, lostRetry);
    dbClaimRetry(db, kept, keptRetry);
    await queue.add("job", request, { jobId: keptRetry });
    await reaper.sweep();
    expect(dbRetriedBy(db, lost)).toBe(lostRetry);
    await reaper.sweep();
    expect(dbRetriedBy(db, lost)).toBeNull();
    expect(dbRetriedBy(db, kept)).toBe(keptRetry);
  });

  test("starting the reaper sweeps at once, and a failing sweep is logged, not thrown", async () => {
    const id = track(randomUUID());
    await publishStatus(redis, { jobId: id, state: "queued", at: Date.now() });
    const logged: string[] = [];
    const stop = startRedisReaper({ ...deps(), log: (message) => logged.push(message) });
    try {
      for (let i = 0; i < 200 && logged.length === 0; i++) await Bun.sleep(25);
      expect(dbGetJob(db, id)?.state).toBe("failed");
      expect(logged).toEqual([`recorded job ${id} as failed: BullMQ no longer has it`]);
    } finally {
      stop();
    }
    const broken = startRedisReaper({
      ...deps(),
      activeIds: () => Promise.reject(new Error("redis is down")),
      log: (message) => logged.push(message),
    });
    try {
      for (let i = 0; i < 200 && logged.length < 2; i++) await Bun.sleep(25);
      expect(logged[1]).toBe("sweep failed: Error: redis is down");
    } finally {
      broken();
    }
  });
});
