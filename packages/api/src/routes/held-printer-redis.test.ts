import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dbRecordJob, openDb } from "@conveyor/shared/db";
import { holdPrinter, releasePrinterHold } from "@conveyor/shared/queue";
import Fastify from "fastify";

const url = process.env.REDIS_URL;
if (!url && process.env.CI)
  throw new Error("REDIS_URL must be set in CI for the Redis held-printer tests");

const request = {
  generator: { id: "gridfinity", params: {} },
  printerId: "klipper-garage",
  profileId: "orca/klipper-pla-0.2",
};

describe.skipIf(!url)("a held printer on the Redis queue", () => {
  let base = "";
  let queue: typeof import("../queue.js");
  const app = Fastify();
  const dir = mkdtempSync(join(tmpdir(), "conveyor-redis-held-"));
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
    holdPrinter(openDb(), { printerId: request.printerId, jobId: "held-by", reason: "x", at: 1 });
  });

  afterAll(async () => {
    releasePrinterHold(openDb(), request.printerId);
    await app.close();
    await queue.jobQueue.close();
    queue.redis.disconnect();
    queue.connection.disconnect();
    openDb().close();
    if (previous === undefined) delete process.env.DB_PATH;
    else process.env.DB_PATH = previous;
    rmSync(dir, { recursive: true, force: true });
  });

  const post = async (body: unknown) => {
    const res = await fetch(`${base}/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };

  test("refuses a new job with a 409 that names the hold, and adds nothing to the queue", async () => {
    const before = await queue.jobQueue.getWaitingCount();
    const { status, body } = await post(request);
    expect([status, body.held]).toEqual([409, true]);
    expect(body.error).toContain("Release hold on the Printers page");
    expect(await queue.jobQueue.getWaitingCount()).toBe(before);
  });

  test("refuses a retry the same way, and leaves the failed job unclaimed", async () => {
    const failed = randomUUID();
    dbRecordJob(openDb(), { ...request, id: failed, generatorId: "gridfinity", state: "failed" });
    const before = await queue.jobQueue.getWaitingCount();
    const { status, body } = await post({ ...request, retryOf: failed });
    expect([status, body.held]).toEqual([409, true]);
    expect(await queue.jobQueue.getWaitingCount()).toBe(before);
    const row = openDb().query("SELECT retried_by FROM jobs WHERE id = ?").get(failed);
    expect(row).toEqual({ retried_by: null });
  });
});
