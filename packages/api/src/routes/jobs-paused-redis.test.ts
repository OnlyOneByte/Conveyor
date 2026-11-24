import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jobCancelKey } from "@conveyor/shared";
import { openDb } from "@conveyor/shared/db";
import Fastify from "fastify";
import { Redis } from "ioredis";
import { registerErrorReplies } from "../error-replies.js";

const url = process.env.REDIS_URL;
if (!url && process.env.CI)
  throw new Error("REDIS_URL must be set in CI for the paused Redis test");

const PAUSE_MS = 2_500;
const request = {
  generator: { id: "gridfinity", params: {} },
  printerId: "klipper-garage",
  profileId: "orca/klipper-pla-0.2",
};

async function until(what: string, ms: number, probe: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await probe()) return;
    await Bun.sleep(50);
  }
  throw new Error(`${what} not within ${ms} ms`);
}

describe.skipIf(!url)("submitting a job while Redis stops answering", () => {
  const app = Fastify();
  const dir = mkdtempSync(join(tmpdir(), "conveyor-redis-paused-"));
  const previous = process.env.DB_PATH;
  let admin: Redis;
  let queue: typeof import("../queue.js");

  beforeAll(async () => {
    process.env.DB_PATH = join(dir, "conveyor.db");
    admin = new Redis(url ?? "");
    queue = await import("../queue.js");
    if (queue.redis.status === "end") await queue.redis.connect();
    if (queue.connection.status === "end") await queue.connection.connect();
    await queue.jobQueue.waitUntilReady();
    const { registerJobRoutes } = await import("./jobs.js");
    registerErrorReplies(app);
    await app.register((await import("@fastify/websocket")).default);
    await registerJobRoutes(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await queue.jobQueue.close();
    queue.redis.disconnect();
    queue.connection.disconnect();
    admin.disconnect();
    openDb().close();
    if (previous === undefined) delete process.env.DB_PATH;
    else process.env.DB_PATH = previous;
    rmSync(dir, { recursive: true, force: true });
  });

  test("answers 503 within the deadline, and the job that lands later is removed and flagged", async () => {
    const add = spyOn(queue.jobQueue, "add");
    await admin.client("PAUSE", PAUSE_MS, "WRITE");
    const started = Date.now();
    const res = await app.inject({ method: "POST", url: "/jobs", payload: request });
    const tookMs = Date.now() - started;
    const jobId = add.mock.calls[0]?.[2]?.jobId ?? "";
    add.mockRestore();

    expect(res.statusCode).toBe(503);
    expect(res.json<{ error: string }>()).toEqual({ error: "queue unavailable" });
    expect(tookMs).toBeLessThan(PAUSE_MS);
    expect(jobId).not.toBe("");

    await until(
      "the cancel flag",
      PAUSE_MS * 3,
      async () => (await admin.exists(jobCancelKey(jobId))) === 1,
    );
    expect(await queue.jobQueue.getJob(jobId)).toBeUndefined();
    await admin.del(jobCancelKey(jobId));
  });

  test(
    "answers job reads with 503 within the deadline while Redis answers nothing",
    async () => {
      for (const url of ["/jobs/active", `/jobs/${randomUUID()}`]) {
        await admin.client("PAUSE", PAUSE_MS, "ALL");
        const started = Date.now();
        const res = await app.inject({ method: "GET", url });
        const tookMs = Date.now() - started;
        expect({ url, status: res.statusCode }).toEqual({ url, status: 503 });
        expect(tookMs).toBeLessThan(PAUSE_MS);
        expect(await admin.ping()).toBe("PONG");
      }
    },
    PAUSE_MS * 4,
  );
});
