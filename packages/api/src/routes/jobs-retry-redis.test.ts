import { afterAll, beforeAll, describe, expect, test } from "bun:test";
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
  const dir = mkdtempSync(join(tmpdir(), "conveyor-redis-retry-"));
  const previous = process.env.DB_PATH;

  beforeAll(async () => {
    process.env.DB_PATH = join(dir, "conveyor.db");
    const { registerJobRoutes } = await import("./jobs.js");
    queue = await import("../queue.js");
    if (queue.redis.status === "end") await queue.redis.connect();
    if (queue.connection.status === "end") await queue.connection.connect();
    await app.register((await import("@fastify/websocket")).default);
    await registerJobRoutes(app);
    base = await app.listen({ host: "127.0.0.1", port: 0 });
  });

  afterAll(async () => {
    for (const id of queued) await (await queue.jobQueue.getJob(id))?.remove();
    await app.close();
    await queue.jobQueue.close();
    queue.redis.disconnect();
    queue.connection.disconnect();
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

  test("a retry takes its failure off the Needs-you list", async () => {
    const failed = failedJob();
    const listed = async () =>
      z
        .array(z.object({ id: z.string() }))
        .parse(await (await fetch(`${base}/jobs/needs-you`)).json())
        .map((j) => j.id);
    expect(await listed()).toEqual([failed]);
    const { status, jobId } = await post({ ...request, retryOf: failed });
    const row = openDb().query("SELECT retried_by FROM jobs WHERE id = ?").get(failed);
    expect([status, await listed(), row]).toEqual([202, [], { retried_by: jobId }]);
  });

  test("of a double retry, sent in turn or at once, one is queued and the rest are 409s", async () => {
    const [one, two] = [failedJob(), failedJob()];
    const before = await queue.jobQueue.getWaitingCount();
    const inTurn = [];
    for (const _ of [1, 2]) inTurn.push(await post({ ...request, retryOf: one }));
    const atOnce = await Promise.all([1, 2, 3].map(() => post({ ...request, retryOf: two })));
    expect(inTurn[1]).toEqual({
      status: 409,
      error: `retryOf: job ${one} is already being retried`,
    });
    expect([inTurn[0]?.status, ...atOnce.map((a) => a.status).sort()]).toEqual([
      202, 202, 409, 409,
    ]);
    expect(await queue.jobQueue.getWaitingCount()).toBe(before + 2);
  });
});
