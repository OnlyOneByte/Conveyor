import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  ACTIVE_JOBS_KEY,
  type JobStatusEvent,
  jobSnapshotKey,
  publishStatus,
} from "@conveyor/shared";
import Fastify from "fastify";
import { Redis } from "ioredis";

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
});
