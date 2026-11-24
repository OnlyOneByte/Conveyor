import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { buildRegistry } from "@conveyor/plugin-registry";
import {
  JOB_QUEUE,
  type JobRequest,
  jobCancelKey,
  jobControlChannel,
  StageError,
} from "@conveyor/shared";
import { dbRecordJob, dbResolveJobTarget, openDb } from "@conveyor/shared/db";
import { readFilamentUse } from "@conveyor/shared/node";
import { type Job, Worker } from "bullmq";
import { Redis, type RedisOptions } from "ioredis";
import { z } from "zod";
import { readJobPayload } from "./job-payload.js";
import { runJob, type TerminalRecord } from "./pipeline.js";
import { markPrinterSeen, resolvePrinterTarget } from "./printer-target.js";
import { resolveProfileForSlice } from "./profile.js";
import { messageOf, type PipelineDeps } from "./run.js";
import { StatusBus } from "./status.js";

export interface RedisWorkerDeps {
  connect: (url: string, options?: RedisOptions) => Redis;
  makeDir: (dir: string) => Promise<unknown>;
  queue: string;
}

export interface RedisWorker {
  worker: Worker<unknown>;
  stop: () => Promise<void>;
}

const defaultDeps: RedisWorkerDeps = {
  connect: (url, options = {}) => new Redis(url, options),
  makeDir: (dir) => mkdir(dir, { recursive: true }),
  queue: JOB_QUEUE,
};

const readable = z.string().optional().catch(undefined);

const looseRequest = z.object({
  generator: z.object({ id: readable, params: z.unknown().optional() }).optional().catch(undefined),
  printerId: readable,
  profileId: readable,
});

function requestOf(data: unknown): JobRequest {
  const loose = looseRequest.safeParse(data);
  const found = loose.success ? loose.data : {};
  return {
    generator: { id: found.generator?.id ?? "unknown", params: found.generator?.params },
    printerId: found.printerId ?? "unknown",
    profileId: found.profileId ?? "unknown",
  };
}

export function startRedisWorker(
  env: Record<string, string | undefined>,
  deps: RedisWorkerDeps = defaultDeps,
): RedisWorker {
  const url = env.REDIS_URL ?? "redis://redis:6379";
  const dataDir = env.DATA_DIR ?? "/data";
  const db = () => openDb(env.DB_PATH);
  const connection = deps.connect(url, { maxRetriesPerRequest: null });
  const commands = deps.connect(url);
  const registry = buildRegistry();
  const bus = new StatusBus(commands);
  const publish: PipelineDeps["publish"] = (id, state, extra) => bus.publish(id, state, extra);

  function recordTerminal(jobId: string, req: JobRequest, extra: TerminalRecord): void {
    dbRecordJob(db(), {
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

  async function failEarly(jobId: string, req: JobRequest, err: unknown): Promise<void> {
    const stage = err instanceof StageError ? err.stage : "generator";
    const reason = err instanceof StageError ? err.reason : messageOf(err);
    try {
      recordTerminal(jobId, req, { state: "failed", stage, reason });
    } catch (recordErr) {
      console.error(`[${jobId}] history not recorded: ${messageOf(recordErr)}`);
    }
    await publish(jobId, "failed", { stage, error: { stage, reason } });
  }

  async function handle(job: Job<unknown>): Promise<unknown> {
    const jobId = job.id;
    if (!jobId) throw new Error("job has no id");
    const controller = new AbortController();
    const control = deps.connect(url);
    try {
      let req = requestOf(job.data);
      let workDir: string;
      try {
        req = await readJobPayload(jobId, job.data, publish);
        workDir = join(dataDir, jobId);
        await deps.makeDir(workDir);
        control.on("message", () => controller.abort());
        await control.subscribe(jobControlChannel(jobId));
      } catch (err) {
        await failEarly(jobId, req, err);
        throw err;
      }
      return await runJob(
        { jobId, req, workDir, controller },
        {
          registry,
          publish,
          record: recordTerminal,
          resolveJobTarget: (r) => dbResolveJobTarget(db(), r.printerId, r.profileId),
          resolvePrinter: async (printerId) => resolvePrinterTarget(db(), printerId),
          printerSeen: (printerId) => markPrinterSeen(db(), printerId),
          readFilament: readFilamentUse,
          resolveProfile: (target, dir) => resolveProfileForSlice(target, dir),
          cancelRequested: async () => (await commands.exists(jobCancelKey(jobId))) === 1,
          log: (msg) => console.log(`[${jobId}] ${msg}`),
        },
      );
    } finally {
      await control.quit().catch(() => control.disconnect());
    }
  }

  const worker = new Worker<unknown>(deps.queue, handle, {
    connection,
    concurrency: Number(env.WORKER_CONCURRENCY ?? 2),
  });
  worker.on("ready", () => console.log("conveyor worker ready"));
  worker.on("failed", (job, err) => console.error(`job ${job?.id} failed:`, err.message));

  return {
    worker,
    stop: async () => {
      await worker.close();
      await Promise.all([connection.quit(), commands.quit()]);
    },
  };
}
