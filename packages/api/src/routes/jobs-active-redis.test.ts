import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  ACTIVE_JOBS_KEY,
  type JobStatusEvent,
  type JobView,
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
  let queue: typeof import("../queue.js");
  const app = Fastify();
  const ids = { old: randomUUID(), fresh: randomUUID(), done: randomUUID(), gone: randomUUID() };
  const mine = new Set<string>(Object.values(ids));

  beforeAll(async () => {
    redis = new Redis(url ?? "");
    const { registerJobRoutes } = await import("./jobs.js");
    queue = await import("../queue.js");
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

  test("adds each job's request fields from BullMQ, and lists a job BullMQ lost without them", async () => {
    const request = {
      generator: { id: "passthrough", params: { uploadId: "u1", filename: "part.stl" } },
      printerId: "klipper-garage",
      profileId: "orca/klipper-pla-0.2",
    };
    const job = await queue.jobQueue.add("job", request, { jobId: ids.fresh });
    try {
      await publishStatus(redis, { jobId: ids.fresh, state: "slicing", at: 40 });
      await publishStatus(redis, { jobId: ids.old, state: "printing", at: 30 });
      const fields = { ...request, createdAt: job.timestamp };
      const listed = ((await (await fetch(`${base}/jobs/active`)).json()) as JobView[]).filter(
        (evt) => mine.has(evt.jobId),
      );
      expect(listed).toEqual([
        { jobId: ids.fresh, state: "slicing", at: 40, seq: expect.any(Number), ...fields },
        { jobId: ids.old, state: "printing", at: 30, seq: expect.any(Number) },
      ]);
      expect(await (await fetch(`${base}/jobs/${ids.fresh}`)).json()).toEqual({
        jobId: ids.fresh,
        state: "slicing",
        at: 40,
        seq: expect.any(Number),
        ...fields,
      });
    } finally {
      await job.remove();
    }
  });

  test("answers the snapshot alone for a request that fails the schema or a BullMQ read that fails", async () => {
    const broken = randomUUID();
    const failing = randomUUID();
    mine.add(broken).add(failing);
    const job = await queue.jobQueue.add("job", { printerId: "" } as never, { jobId: broken });
    try {
      await publishStatus(redis, { jobId: broken, state: "queued", at: 50 });
      await publishStatus(redis, { jobId: failing, state: "slicing", at: 51 });
      const bare = (id: string, state: string, at: number) => ({
        jobId: id,
        state,
        at,
        seq: expect.any(Number),
      });
      const one = await fetch(`${base}/jobs/${broken}`);
      expect(await one.json()).toEqual(bare(broken, "queued", 50));
      const spy = spyOn(queue.jobQueue, "getJob").mockRejectedValueOnce(new Error("redis down"));
      const res = await fetch(`${base}/jobs/${failing}`);
      spy.mockRestore();
      expect([res.status, await res.json()]).toEqual([200, bare(failing, "slicing", 51)]);
    } finally {
      await job.remove();
    }
  });
});
