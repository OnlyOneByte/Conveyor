import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ACTIVE_JOBS_KEY,
  type JobStatusEvent,
  jobSnapshotKey,
  publishStatus,
} from "@conveyor/shared";
import { dbRecordJob, openDb } from "@conveyor/shared/db";
import Fastify from "fastify";
import { Redis } from "ioredis";
import { z } from "zod";

const url = process.env.REDIS_URL;
if (!url && process.env.CI)
  throw new Error("REDIS_URL must be set in CI for the Redis /jobs/active tests");

describe.skipIf(!url)("GET /jobs/active on Redis", () => {
  let redis: Redis;
  let base = "";
  let closeQueue = async () => {};
  const app = Fastify();
  const ids = { old: randomUUID(), fresh: randomUUID(), done: randomUUID(), gone: randomUUID() };
  const mine = new Set<string>(Object.values(ids));

  beforeAll(async () => {
    redis = new Redis(url ?? "");
    const { registerJobRoutes } = await import("./jobs.js");
    const queue = await import("../queue.js");
    if (queue.redis.status === "end") await queue.redis.connect();
    closeQueue = async () => {
      await queue.jobQueue.close();
      queue.redis.disconnect();
      queue.connection.disconnect();
    };
    await app.register((await import("@fastify/websocket")).default);
    await registerJobRoutes(app);
    base = await app.listen({ host: "127.0.0.1", port: 0 });
  });

  afterAll(async () => {
    await redis.srem(ACTIVE_JOBS_KEY, ...mine);
    await redis.del(...[...mine].map(jobSnapshotKey));
    await app.close();
    await closeQueue();
    redis.disconnect();
  });

  test("lists live jobs newest first and prunes finished or missing members", async () => {
    await publishStatus(redis, { jobId: ids.old, state: "printing", at: 10 });
    await publishStatus(redis, { jobId: ids.fresh, state: "slicing", at: 20 });
    const finished: JobStatusEvent = { jobId: ids.done, state: "done", at: 30 };
    await redis.set(jobSnapshotKey(ids.done), JSON.stringify(finished));
    await redis.sadd(ACTIVE_JOBS_KEY, ids.done, ids.gone);

    const res = await fetch(`${base}/jobs/active`);
    expect(res.status).toBe(200);
    const listed = ((await res.json()) as JobStatusEvent[]).filter((evt) => mine.has(evt.jobId));
    expect(listed.map((evt) => [evt.jobId, evt.state])).toEqual([
      [ids.fresh, "slicing"],
      [ids.old, "printing"],
    ]);
    expect(
      await Promise.all(Object.values(ids).map((id) => redis.sismember(ACTIVE_JOBS_KEY, id))),
    ).toEqual([1, 1, 0, 0]);
  });

  test("adds typical durations from history to a live job, using its queued request", async () => {
    const dir = mkdtempSync(join(tmpdir(), "conveyor-redis-estimates-"));
    const previous = process.env.DB_PATH;
    process.env.DB_PATH = join(dir, "conveyor.db");
    const jobId = randomUUID();
    mine.add(jobId);
    const settled = { generatorId: "gridfinity", printerId: "estimate-printer", profileId: "prof" };
    const timings = [{ stage: "slicer" as const, enteredAt: 0, durationMs: 4_000 }];
    try {
      for (const i of [1, 2, 3])
        dbRecordJob(openDb(), { ...settled, id: `${jobId}-${i}`, state: "done", timings });
      const { jobQueue } = await import("../queue.js");
      const request = { ...settled, generator: { id: "gridfinity", params: {} } };
      await jobQueue.add("job", request, { jobId });
      await publishStatus(redis, { jobId, state: "queued", at: 40 });
      const listed = z
        .array(z.object({ jobId: z.string(), estimate: z.unknown().optional() }))
        .parse(await (await fetch(`${base}/jobs/active`)).json());
      expect(listed.find((evt) => evt.jobId === jobId)?.estimate).toEqual({
        typicalMs: { slicer: 4_000 },
        startsAt: expect.any(Number),
      });
      await (await jobQueue.getJob(jobId))?.remove();
    } finally {
      openDb().close();
      if (previous === undefined) delete process.env.DB_PATH;
      else process.env.DB_PATH = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
