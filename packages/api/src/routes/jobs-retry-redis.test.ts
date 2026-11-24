import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dbRecordJob, openDb } from "@conveyor/shared/db";
import Fastify from "fastify";
import { z } from "zod";

const url = process.env.REDIS_URL;
if (!url && process.env.CI)
  throw new Error("REDIS_URL must be set in CI for the Redis retry tests");

const request = {
  generator: { id: "gridfinity", params: {} },
  printerId: "klipper-garage",
  profileId: "orca/klipper-pla-0.2",
};

describe.skipIf(!url)("retrying a failed job on the Redis queue", () => {
  let base = "";
  let queue: typeof import("../queue.js");
  const app = Fastify();
  const queued: string[] = [];
  let dir = "";
  let previous: string | undefined;

  beforeAll(async () => {
    const { registerJobRoutes } = await import("./jobs.js");
    queue = await import("../queue.js");
    if (queue.redis.status === "end") await queue.redis.connect();
    if (queue.connection.status === "end") await queue.connection.connect();
    await app.register((await import("@fastify/websocket")).default);
    await registerJobRoutes(app);
    base = await app.listen({ host: "127.0.0.1", port: 0 });
  });

  afterAll(async () => {
    await app.close();
    await queue.jobQueue.close();
    queue.redis.disconnect();
    queue.connection.disconnect();
  });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "conveyor-redis-retry-"));
    previous = process.env.DB_PATH;
    process.env.DB_PATH = join(dir, "conveyor.db");
  });

  afterEach(async () => {
    for (const id of queued.splice(0)) await (await queue.jobQueue.getJob(id))?.remove();
    openDb().close();
    if (previous === undefined) delete process.env.DB_PATH;
    else process.env.DB_PATH = previous;
    rmSync(dir, { recursive: true, force: true });
  });

  const failedJob = () => {
    const id = randomUUID();
    dbRecordJob(openDb(), { ...request, id, generatorId: "gridfinity", state: "failed" });
    return id;
  };
  const listed = async () =>
    z
      .array(z.object({ id: z.string() }))
      .parse(await (await fetch(`${base}/jobs/needs-you`)).json())
      .map((j) => j.id);
  const post = async (body: unknown) => {
    const res = await fetch(`${base}/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const answer = z
      .object({ jobId: z.string().optional(), error: z.string().optional() })
      .parse(await res.json());
    if (answer.jobId) queued.push(answer.jobId);
    return { status: res.status, ...answer };
  };
  const waiting = () => queue.jobQueue.getWaitingCount();

  test("a retry takes its failure off the Needs-you list; an unknown retryOf is a 400", async () => {
    const failed = failedJob();
    expect(await listed()).toEqual([failed]);
    expect(await post({ ...request, retryOf: "nope" })).toEqual({
      status: 400,
      error: "retryOf: unknown job nope",
    });
    const res = await post({ ...request, retryOf: failed });
    expect([res.status, await listed()]).toEqual([202, []]);
  });

  test("a second retry of the same failure is a 409 naming retryOf, and queues nothing", async () => {
    const failed = failedJob();
    const before = await waiting();
    const first = await post({ ...request, retryOf: failed });
    const second = await post({ ...request, retryOf: failed });
    expect([first.status, second]).toEqual([
      202,
      { status: 409, error: `retryOf: job ${failed} is already being retried` },
    ]);
    expect(await waiting()).toBe(before + 1);
  });

  test("two retries sent at once queue exactly one job", async () => {
    const failed = failedJob();
    const before = await waiting();
    const answers = await Promise.all([1, 2, 3].map(() => post({ ...request, retryOf: failed })));
    expect(answers.map((a) => a.status).sort()).toEqual([202, 409, 409]);
    expect(await waiting()).toBe(before + 1);
  });
});
