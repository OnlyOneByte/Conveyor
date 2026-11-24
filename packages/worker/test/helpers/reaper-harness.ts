import type { Database } from "bun:sqlite";
import { afterAll, afterEach, beforeAll, beforeEach } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ACTIVE_JOBS_KEY,
  type JobRequest,
  jobSnapshotKey,
  parseStatusEvent,
} from "@conveyor/shared";
import { openDb } from "@conveyor/shared/db";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import {
  createRedisReaper,
  type RedisReaper,
  type RedisReaperDeps,
  redisReaperDeps,
} from "../../src/redis-reaper.js";

export const reaperUrl = process.env.REDIS_URL;
if (!reaperUrl && process.env.CI)
  throw new Error("REDIS_URL must be set in CI for the Redis reaper tests");

export const request: JobRequest = {
  generator: { id: "gridfinity", params: { gridX: 2 } },
  printerId: "klipper-garage",
  profileId: "orca/klipper-pla-0.2",
};

interface Scope {
  queue: Queue<JobRequest>;
  queueName: string;
  db: Database;
  dir: string;
}

export function useReaperHarness() {
  const mine = new Set<string>();
  const connect = () => new Redis(reaperUrl ?? "", { maxRetriesPerRequest: null });
  let shared: Redis | undefined;
  let scope: Scope | undefined;

  const parts = () => {
    if (!shared || !scope) throw new Error("the reaper harness is used outside a test");
    return { redis: shared, ...scope };
  };
  const deps = (): RedisReaperDeps => {
    const { redis, queue, db } = parts();
    return {
      ...redisReaperDeps(redis, queue, () => {}),
      db: () => db,
      activeIds: async () => (await redis.smembers(ACTIVE_JOBS_KEY)).filter((id) => mine.has(id)),
    };
  };
  let reaper: RedisReaper | undefined;

  beforeAll(() => {
    shared = connect();
  });

  afterAll(() => {
    shared?.disconnect();
  });

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "conveyor-redis-reaper-"));
    const queueName = `reaper-${randomUUID()}`;
    scope = {
      dir,
      queueName,
      queue: new Queue<JobRequest>(queueName, { connection: connect() }),
      db: openDb(join(dir, "conveyor.db")),
    };
    mine.clear();
    reaper = createRedisReaper(deps());
  });

  afterEach(async () => {
    const { redis, queue, db, dir } = parts();
    if (mine.size) {
      await redis.srem(ACTIVE_JOBS_KEY, ...mine);
      await redis.del(...[...mine].map(jobSnapshotKey));
    }
    await queue.obliterate({ force: true });
    await queue.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  return () => {
    const { redis, queue, queueName, db } = parts();
    if (!reaper) throw new Error("the reaper harness is used outside a test");
    return {
      redis,
      queue,
      queueName,
      db,
      reaper,
      connect,
      deps,
      track: (id: string) => {
        mine.add(id);
        return id;
      },
      snapshotOf: async (id: string) => parseStatusEvent(await redis.get(jobSnapshotKey(id))),
      async stateOf(id: string, wanted: string): Promise<void> {
        for (let i = 0; i < 400; i++) {
          if ((await (await queue.getJob(id))?.getState()) === wanted) return;
          await Bun.sleep(25);
        }
        throw new Error(`job ${id} never reached ${wanted}`);
      },
    };
  };
}
