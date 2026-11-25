import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ACTIVE_JOBS_KEY,
  JOB_QUEUE,
  type JobRequest,
  type JobStatusEvent,
  type JobView,
  jobSnapshotKey,
  publishStatus,
} from "@conveyor/shared";
import { dbRecordJob, openDb } from "@conveyor/shared/db";
import { Queue } from "bullmq";
import Fastify from "fastify";
import { Redis } from "ioredis";
import { z } from "zod";
import { dropsItsRedisKeys } from "../../../shared/test/helpers/index.ts";

const url = process.env.REDIS_URL;
if (!url && process.env.CI)
  throw new Error("REDIS_URL must be set in CI for the Redis /jobs/active tests");

describe.skipIf(!url)("GET /jobs/active on Redis", () => {
  let redis: Redis;
  let base = "";
  let closeQueue = async () => {};
  let queue: typeof import("../queue.js");
  let jobs: Queue<JobRequest>;
  const app = Fastify();
  let ids = { old: "", fresh: "", done: "", gone: "" };
  let mine = new Set<string>();
  const reads: string[] = [];

  beforeEach(() => {
    ids = { old: randomUUID(), fresh: randomUUID(), done: randomUUID(), gone: randomUUID() };
    mine = new Set(Object.values(ids));
  });

  afterEach(async () => {
    await redis.srem(ACTIVE_JOBS_KEY, ...mine);
    await redis.del(...[...mine].map(jobSnapshotKey));
  });

  beforeAll(async () => {
    redis = new Redis(url ?? "");
    const { registerJobRoutes } = await import("./jobs.js");
    queue = await import("../queue.js");
    if (queue.redis.status === "end") await queue.redis.connect();
    if (queue.connection.status === "end") await queue.connection.connect();
    closeQueue = async () => {
      await queue.jobQueue.close();
      queue.redis.disconnect();
      queue.connection.disconnect();
    };
    await app.register((await import("@fastify/websocket")).default);
    jobs = new Queue<JobRequest>(JOB_QUEUE, {
      connection: new Redis(url ?? "", { maxRetriesPerRequest: null }),
    });
    const getJob = (id: string) => {
      reads.push(id);
      return jobs.getJob(id);
    };
    await registerJobRoutes(app, { getJob });
    base = await app.listen({ host: "127.0.0.1", port: 0 });
  });

  afterAll(async () => {
    await app.close();
    await closeQueue();
    await jobs.close();
    await jobs.disconnect();
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

  test("a snapshot that isn't JSON answers 404, not 500", async () => {
    const corrupt = randomUUID();
    mine.add(corrupt);
    await redis.set(jobSnapshotKey(corrupt), "{");
    const res = await fetch(`${base}/jobs/${corrupt}`);
    expect([res.status, await res.json()]).toEqual([404, { error: "unknown job" }]);
  });

  test("answers the snapshot alone for a request that fails the schema or a BullMQ read that fails", async () => {
    const broken = randomUUID();
    const failing = randomUUID();
    mine.add(broken).add(failing);
    const untyped = new Queue(JOB_QUEUE, {
      connection: new Redis(url ?? "", { maxRetriesPerRequest: null }),
    });
    const job = await untyped.add("job", { printerId: "" }, { jobId: broken });
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
      const spy = spyOn(jobs, "getJob").mockRejectedValueOnce(new Error("redis down"));
      const res = await fetch(`${base}/jobs/${failing}`);
      spy.mockRestore();
      expect([res.status, await res.json()]).toEqual([200, bare(failing, "slicing", 51)]);
    } finally {
      await job.remove();
      await untyped.close();
      await untyped.disconnect();
    }
  });

  test("adds typical durations from history to a live job, using its queued request", async () => {
    const dir = mkdtempSync(join(tmpdir(), "conveyor-redis-estimates-"));
    const previous = process.env.DB_PATH;
    process.env.DB_PATH = join(dir, "conveyor.db");
    const jobId = randomUUID();
    const settled = { generatorId: "gridfinity", printerId: "estimate-printer", profileId: "prof" };
    const timings = [{ stage: "slicer" as const, enteredAt: 0, durationMs: 4_000 }];
    try {
      for (const i of [1, 2, 3])
        dbRecordJob(openDb(), { ...settled, id: `${jobId}-${i}`, state: "done", timings });
      const request = { ...settled, generator: { id: "gridfinity", params: {} } };
      const job = await jobs.add("job", request, { jobId });
      await publishStatus(redis, { jobId, state: "queued", at: 40 });
      const listed = z
        .array(z.looseObject({ jobId: z.string() }))
        .parse(await (await fetch(`${base}/jobs/active`)).json());
      expect(listed.find((evt) => evt.jobId === jobId)).toMatchObject({
        estimate: { typicalMs: { slicer: 4_000 } },
        printerId: request.printerId,
        profileId: request.profileId,
        generator: request.generator,
        createdAt: job.timestamp,
      });
    } finally {
      await (await jobs.getJob(jobId))?.remove();
      await redis.srem(ACTIVE_JOBS_KEY, jobId);
      await redis.del(jobSnapshotKey(jobId));
      openDb().close();
      if (previous === undefined) delete process.env.DB_PATH;
      else process.env.DB_PATH = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("reads each live job from BullMQ once per request", async () => {
    await publishStatus(redis, { jobId: ids.old, state: "printing", at: 60 });
    await publishStatus(redis, { jobId: ids.fresh, state: "queued", at: 61 });
    reads.length = 0;
    expect((await fetch(`${base}/jobs/active`)).status).toBe(200);
    expect(reads.filter((id) => mine.has(id)).sort()).toEqual([ids.old, ids.fresh].sort());
  });

  test("serves the Needs-you list and dismiss routes", () => {
    expect(app.hasRoute({ method: "GET", url: "/jobs/needs-you" })).toBe(true);
    expect(app.hasRoute({ method: "POST", url: "/jobs/:id/dismiss" })).toBe(true);
  });
});

dropsItsRedisKeys();
