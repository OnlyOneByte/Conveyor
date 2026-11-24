import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { buildRegistry } from "@conveyor/plugin-registry";
import { JOB_QUEUE, type JobRequest, jobCancelKey, jobControlChannel } from "@conveyor/shared";
import { dbRecordJob, dbResolveJobTarget, openDb } from "@conveyor/shared/db";
import { readFilamentUse } from "@conveyor/shared/node";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { readJobPayload } from "./job-payload.js";
import { runJob, type TerminalRecord } from "./pipeline.js";
import { markPrinterSeen, resolvePrinterTarget } from "./printer-target.js";
import { resolveProfileForSlice } from "./profile.js";
import { redisReaperDeps, startRedisReaper } from "./redis-reaper.js";
import { StatusBus } from "./status.js";

const REDIS_URL = process.env.REDIS_URL ?? "redis://redis:6379";
const DATA_DIR = process.env.DATA_DIR ?? "/data";
const connection = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
const commands = new Redis(REDIS_URL);

const registry = buildRegistry();
const bus = new StatusBus();

const worker = new Worker<unknown>(
  JOB_QUEUE,
  async (job) => {
    const jobId = job.id;
    if (!jobId) throw new Error("job has no id");
    const req = await readJobPayload(jobId, job.data, (id, state, extra) =>
      bus.publish(id, state, extra),
    );
    const workDir = join(DATA_DIR, jobId);
    await mkdir(workDir, { recursive: true });

    const controller = new AbortController();
    const control = new Redis(REDIS_URL);
    control.on("message", () => controller.abort());
    await control.subscribe(jobControlChannel(jobId));

    try {
      return await runJob(
        { jobId, req, workDir, controller },
        {
          registry,
          publish: (id, state, extra) => bus.publish(id, state, extra),
          record: recordTerminal,
          resolveJobTarget: (r) => dbResolveJobTarget(openDb(), r.printerId, r.profileId),
          resolvePrinter: async (printerId) => resolvePrinterTarget(openDb(), printerId),
          printerSeen: (printerId) => markPrinterSeen(openDb(), printerId),
          readFilament: readFilamentUse,
          resolveProfile: (target, dir) => resolveProfileForSlice(target, dir),
          cancelRequested: async () => (await commands.exists(jobCancelKey(jobId))) === 1,
          log: (msg) => console.log(`[${jobId}] ${msg}`),
        },
      );
    } finally {
      await control.quit();
    }
  },
  { connection, concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2) },
);

worker.on("ready", () => console.log("conveyor worker ready"));
worker.on("failed", (job, err) => console.error(`job ${job?.id} failed:`, err.message));

const lookup = new Queue(JOB_QUEUE, { connection });
startRedisReaper(
  redisReaperDeps(commands, lookup, (message) => console.log(`[reaper] ${message}`)),
);

function recordTerminal(jobId: string, req: JobRequest, extra: TerminalRecord): void {
  dbRecordJob(openDb(), {
    id: jobId,
    generatorId: req.generator.id,
    params: req.generator.params,
    printerId: req.printerId,
    profileId: req.profileId,
    state: extra.state,
    stage: extra.stage ?? null,
    error: extra.stage && extra.reason ? { stage: extra.stage, reason: extra.reason } : undefined,
    modelPath: extra.modelPath,
    gcodePath: extra.gcodePath,
    timings: extra.timings,
    filament: extra.filament,
    notes: extra.notes,
  });
}
