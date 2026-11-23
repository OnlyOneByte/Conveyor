import { afterAll, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isTerminal,
  type JobRequest,
  type JobState,
  jobCancelKey,
  jobControlChannel,
  jobSnapshotKey,
  parseStatusEvent,
} from "@conveyor/shared";
import { dbGetJob, openDb } from "@conveyor/shared/db";
import { Job, type JobState as QueueState } from "bullmq";
import Fastify from "fastify";
import { connection, jobQueue, redis } from "../queue.js";
import { registerJobRoutes } from "./jobs.js";

connection.disconnect();
redis.disconnect();

const dir = mkdtempSync(join(tmpdir(), "conveyor-jobs-cancel-"));
const previousDbPath = process.env.DB_PATH;
const store = new Map<string, string>();
const app = Fastify({ forceCloseConnections: true });
let base = "";

const QUEUED = "6f1d2c3b-4a5e-4f60-8a71-9b2c3d4e5f60";
const RACE = "7a2e3d4c-5b6f-4071-9b82-ac3d4e5f6071";

const request: JobRequest = {
  generator: { id: "gridfinity", params: { gridX: 2 } },
  printerId: "klipper-garage",
  profileId: "orca/klipper-pla-0.2",
};

function installFakes() {
  return {
    getJob: spyOn(jobQueue, "getJob").mockResolvedValue(undefined),
    get: spyOn(redis, "get").mockImplementation(async (key) => store.get(String(key)) ?? null),
    evalScript: spyOn(redis, "eval").mockImplementation(async (...args) => {
      const [, , snapshotKey, , , , event] = args.map(String);
      const prev = parseStatusEvent(store.get(snapshotKey));
      if (prev && isTerminal(prev.state)) return 0;
      store.set(snapshotKey, event);
      return 1;
    }),
  };
}

let fakes: ReturnType<typeof installFakes>;

const cancel = (id: string) => fetch(`${base}/jobs/${id}/cancel`, { method: "POST" });

function snapshot(jobId: string, state: JobState): void {
  store.set(jobSnapshotKey(jobId), JSON.stringify({ jobId, state, at: 1 }));
}

function queuedJob(state: QueueState): Job {
  const job = new Job(jobQueue, "job", request, {}, QUEUED);
  spyOn(job, "getState").mockResolvedValue(state);
  spyOn(job, "remove").mockResolvedValue(undefined);
  return job;
}

function stubPipeline() {
  const pipeline = redis.multi();
  const set = spyOn(pipeline, "set");
  const publish = spyOn(pipeline, "publish");
  spyOn(pipeline, "exec").mockResolvedValue([]);
  const multi = spyOn(redis, "multi").mockReturnValue(pipeline);
  return { set, publish, multi };
}

beforeAll(async () => {
  process.env.DB_PATH = join(dir, "conveyor.db");
  openDb();
  fakes = installFakes();
  await registerJobRoutes(app);
  base = await app.listen({ host: "127.0.0.1", port: 0 });
});

beforeEach(() => {
  store.clear();
  for (const spy of Object.values(fakes)) spy.mockClear();
  fakes.getJob.mockResolvedValue(undefined);
});

afterAll(async () => {
  await app.close();
  mock.restore();
  openDb().close();
  if (previousDbPath === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = previousDbPath;
  rmSync(dir, { recursive: true, force: true });
});

describe("POST /jobs/:id/cancel", () => {
  test("an unknown job is a 404 and signals nothing", async () => {
    const { multi } = stubPipeline();
    const res = await cancel("ghost");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, jobId: "ghost", error: "unknown job" });
    expect(multi).not.toHaveBeenCalled();
    multi.mockRestore();
  });

  test("a waiting job is removed, settled canceled and recorded", async () => {
    fakes.getJob.mockResolvedValue(queuedJob("waiting"));
    const { set, publish, multi } = stubPipeline();
    const res = await cancel(QUEUED);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, jobId: QUEUED, state: "canceled" });
    expect(set).toHaveBeenCalledWith(jobCancelKey(QUEUED), "1", "EX", 604800);
    expect(publish).toHaveBeenCalledWith(jobControlChannel(QUEUED), "cancel");
    expect(parseStatusEvent(store.get(jobSnapshotKey(QUEUED)))?.state).toBe("canceled");
    expect(dbGetJob(openDb(), QUEUED)).toMatchObject({
      state: "canceled",
      request: { generator: { id: "gridfinity", params: { gridX: 2 } } },
    });
    multi.mockRestore();
  });

  test("an active job is only signalled, and answers 202 canceling", async () => {
    fakes.getJob.mockResolvedValue(queuedJob("active"));
    snapshot(QUEUED, "printing");
    const { multi } = stubPipeline();
    const res = await cancel(QUEUED);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true, jobId: QUEUED, state: "canceling" });
    expect(fakes.evalScript).not.toHaveBeenCalled();
    expect(multi).toHaveBeenCalledTimes(1);
    multi.mockRestore();
  });

  test("a job that already finished stays finished", async () => {
    snapshot(QUEUED, "done");
    const res = await cancel(QUEUED);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, jobId: QUEUED, state: "done" });
    expect(fakes.getJob).not.toHaveBeenCalled();
  });

  test("a lost settle race records nothing in the history", async () => {
    fakes.getJob.mockResolvedValue(queuedJob("waiting"));
    fakes.evalScript.mockResolvedValueOnce(0);
    const { multi } = stubPipeline();
    const res = await cancel(RACE);
    expect(res.status).toBe(200);
    expect(fakes.evalScript).toHaveBeenCalledTimes(1);
    expect(dbGetJob(openDb(), RACE)).toBeNull();
    multi.mockRestore();
  });
});
