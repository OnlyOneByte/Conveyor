import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JOB_QUEUE, type JobRequest } from "@conveyor/shared";
import { type Job, Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { type BootedApi, bootApi } from "../../test/booted-api.ts";

const url = process.env.REDIS_URL;
if (!url && process.env.CI)
  throw new Error("REDIS_URL must be set in CI for the Redis delete tests");

const PRINTER = "redis-delete-busy";
const dir = mkdtempSync(join(tmpdir(), "conveyor-catalog-redis-"));
let api: BootedApi | undefined;
let queue: Queue<JobRequest> | undefined;
let worker: Worker<JobRequest> | undefined;
let added: Job<JobRequest> | undefined;
const connections: Redis[] = [];

const connect = (target: string) => {
  const redis = new Redis(target, { maxRetriesPerRequest: null });
  connections.push(redis);
  return redis;
};
const booted = () => {
  if (!api) throw new Error("api not booted");
  return api.base;
};
const deletePrinter = async () =>
  (await fetch(`${booted()}/catalog/printers/${PRINTER}`, { method: "DELETE" })).status;

async function stateOf(job: Job<JobRequest>, wanted: string): Promise<void> {
  for (let i = 0; i < 800; i++) {
    if ((await job.getState()) === wanted) return;
    await Bun.sleep(25);
  }
  throw new Error(`job ${job.id} never reached ${wanted}, last state ${await job.getState()}`);
}

describe.skipIf(!url)(
  "DELETE /catalog/printers/:id on the Redis queue, booted through index.ts",
  () => {
    beforeAll(async () => {
      const target = url ?? "";
      api = await bootApi(dir, {
        REDIS_URL: target,
        CONVEYOR_QUEUE: "redis",
        CONVEYOR_AUTH: "disabled",
      });
      queue = new Queue<JobRequest>(JOB_QUEUE, { connection: connect(target) });
      const saved = await fetch(`${booted()}/catalog/printers`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: PRINTER,
          transportId: "moonraker",
          name: "Busy",
          address: "10.0.0.4",
        }),
      });
      expect(saved.status).toBe(200);
    });

    afterAll(async () => {
      await worker?.close();
      await added?.remove();
      await queue?.close();
      for (const redis of connections) redis.disconnect();
      await api?.stop();
      rmSync(dir, { recursive: true, force: true });
    });

    test("a waiting job and then a running job both block the delete, and a finished one does not", async () => {
      if (!queue || !url) throw new Error("not set up");
      const job = await queue.add(
        "job",
        {
          generator: { id: "gridfinity", params: {} },
          printerId: PRINTER,
          profileId: "orca/klipper-pla-0.2",
        },
        { jobId: `redis-delete-${Date.now()}` },
      );
      added = job;
      expect(await deletePrinter()).toBe(409);

      let release = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      worker = new Worker<JobRequest>(
        JOB_QUEUE,
        async (taken) => (taken.id === job.id ? held : undefined),
        { connection: connect(url), concurrency: 8 },
      );
      await stateOf(job, "active");
      expect(await deletePrinter()).toBe(409);

      release();
      await stateOf(job, "completed");
      expect(await deletePrinter()).toBe(200);
    }, 30_000);
  },
);
