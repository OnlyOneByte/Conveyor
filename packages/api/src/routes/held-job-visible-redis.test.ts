import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { JOB_QUEUE } from "@conveyor/shared";
import { dbRecordJob, openDb } from "@conveyor/shared/db";
import { holdPrinter } from "@conveyor/shared/queue";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { z } from "zod";
import { type BootedApi, bootApi, job } from "../../test/helpers/booted-api.ts";

const url = process.env.REDIS_URL;
if (!url && process.env.CI)
  throw new Error("REDIS_URL must be set in CI for the Redis held-job visibility test");

const ISOLATED_DB = "13";
const WORKER = resolve(import.meta.dir, "../../../worker/src/main.ts");
const PROFILES = resolve(import.meta.dir, "../../../../profiles");
const HOLD = "may have started";
const WAITING = `waiting: the printer is on hold (${HOLD})`;

const view = z.looseObject({
  jobId: z.string(),
  state: z.string(),
  message: z.string().optional(),
  estimate: z.looseObject({ startsAt: z.number().optional() }).optional(),
  at: z.number().optional(),
});

function isolated(base: string): string {
  const u = new URL(base);
  u.pathname = `/${ISOLATED_DB}`;
  return u.toString();
}

async function until<T>(what: string, ms: number, probe: () => Promise<T | undefined>): Promise<T> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value !== undefined) return value;
    await Bun.sleep(20);
  }
  throw new Error(`${what} not within ${ms} ms`);
}

describe.skipIf(!url)("a job waiting on a printer hold on the Redis queue", () => {
  const dir = mkdtempSync(join(tmpdir(), "conveyor-held-visible-"));
  const redisUrl = isolated(url ?? "redis://127.0.0.1:6379");
  let api: BootedApi | undefined;
  let worker: ReturnType<typeof Bun.spawn> | undefined;
  const ids: string[] = [];
  const base = () => api?.base ?? "";
  const read = async (path: string) => fetch(`${base()}${path}`);
  const active = async () => z.array(view).parse(await (await read("/jobs/active")).json());

  beforeAll(async () => {
    const queue = new Queue(JOB_QUEUE, {
      connection: new Redis(redisUrl, { maxRetriesPerRequest: null }),
    });
    await queue.obliterate({ force: true });
    await queue.close();
    api = await bootApi(dir, {
      REDIS_URL: redisUrl,
      CONVEYOR_QUEUE: "redis",
      CONVEYOR_AUTH: "disabled",
    });
    const db = openDb(join(dir, "conveyor.db"));
    for (let i = 0; i < 3; i++) {
      dbRecordJob(db, {
        ...job,
        id: `typical-${i}`,
        generatorId: job.generator.id,
        state: "done",
        timings: [
          { stage: "generator", enteredAt: 0, durationMs: 1000 },
          { stage: "slicer", enteredAt: 1000, durationMs: 1000 },
          { stage: "transport", enteredAt: 2000, durationMs: 1000 },
        ],
      });
    }
    for (let i = 0; i < 3; i++) {
      const posted = await fetch(`${base()}/jobs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(job),
      });
      ids.push(z.object({ jobId: z.string() }).parse(await posted.json()).jobId);
      await Bun.sleep(5);
    }
    holdPrinter(db, {
      printerId: job.printerId,
      jobId: "earlier",
      reason: HOLD,
      at: 1,
    });
    worker = Bun.spawn([process.execPath, WORKER], {
      cwd: dir,
      env: {
        ...process.env,
        CONVEYOR_ENGINE_STUB: "1",
        REDIS_URL: redisUrl,
        DB_PATH: join(dir, "conveyor.db"),
        DATA_DIR: dir,
        CONVEYOR_PROFILES_ROOT: PROFILES,
        WORKER_CONCURRENCY: "1",
      },
      stdout: "ignore",
      stderr: "ignore",
    });
  });

  afterAll(async () => {
    worker?.kill();
    await worker?.exited;
    await api?.stop();
    const redis = new Redis(redisUrl);
    await redis.flushdb();
    redis.disconnect();
    rmSync(dir, { recursive: true, force: true });
  });

  test("is shown queued with no start estimate until Release hold, then the jobs run oldest first", async () => {
    const listed = await until("all three jobs shown waiting", 20_000, async () => {
      const shown = (await active()).filter((evt) => ids.includes(evt.jobId));
      return shown.length === 3 && shown.every((evt) => evt.message === WAITING)
        ? shown
        : undefined;
    });
    for (const evt of listed) {
      expect(evt).toMatchObject({ state: "queued", message: WAITING });
      expect(evt.estimate?.startsAt).toBeUndefined();
    }
    for (const id of ids) {
      const res = await read(`/jobs/${id}`);
      expect(res.status).toBe(200);
      expect(view.parse(await res.json())).toMatchObject({ state: "queued", message: WAITING });
    }

    const release = await fetch(`${base()}/catalog/printers/${job.printerId}/release`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: true }),
    });
    expect(release.status).toBe(200);
    const finished = await until("all three jobs to finish", 40_000, async () => {
      const shown = await Promise.all(
        ids.map(async (id) => view.parse(await (await read(`/jobs/${id}`)).json())),
      );
      return shown.every((evt) => evt.state === "done") ? shown : undefined;
    });
    const at = finished.map((evt) => z.number().parse(evt.at));
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(new Set(at).size).toBe(3);
  }, 90_000);
});
