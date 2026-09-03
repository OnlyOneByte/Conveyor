import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  JOB_QUEUE,
  StageError,
  type JobRequest,
  type PrinterTarget,
  type Stage,
  type StageCtx,
} from "@conveyor/shared";
import { openDb, dbGetPrinter, dbRecordJob, dbResolveJobTarget } from "@conveyor/shared/db";
import { buildRegistry } from "./registry.js";
import { StatusBus } from "./status.js";
import { resolveProfileForSlice } from "./profile.js";

const REDIS_URL = process.env.REDIS_URL ?? "redis://redis:6379";
const DATA_DIR = process.env.DATA_DIR ?? "/data";
const connection = new Redis(REDIS_URL, { maxRetriesPerRequest: null });

const registry = buildRegistry();
const bus = new StatusBus();

const worker = new Worker<JobRequest>(
  JOB_QUEUE,
  async (job) => {
    const jobId = job.id!;
    const req = job.data;
    const workDir = join(DATA_DIR, jobId);
    await mkdir(workDir, { recursive: true });

    // Cooperative cancel: API publishes to job:<id>:control.
    const controller = new AbortController();
    const control = new Redis(REDIS_URL);
    await control.subscribe(`job:${jobId}:control`);
    control.on("message", () => controller.abort());

    const ctx: StageCtx = {
      jobId,
      workDir,
      signal: controller.signal,
      report: (progress, message) => void bus.publish(jobId, currentState, { stage, progress, message }),
      log: (msg) => console.log(`[${jobId}] ${msg}`),
    };

    let stage: "generator" | "slicer" | "transport" = "generator";
    let currentState: "generating" | "slicing" | "transferring" | "printing" = "generating";
    // Artifact paths captured as stages complete, persisted to the job history.
    let modelPath: string | undefined;
    let gcodePath: string | undefined;

    try {
      // The (printer, profile) pair the request names, with the transport and slicer
      // derived from it — what a Station used to hold.
      const jobTarget = dbResolveJobTarget(openDb(), req.printerId, req.profileId);
      if (!jobTarget) {
        throw new StageError("generator", `unknown printer ${req.printerId} or profile ${req.profileId}`);
      }

      // ── Generate ───────────────────────────────────────────────
      stage = "generator";
      currentState = "generating";
      await bus.publish(jobId, "generating", { stage });
      const generator = registry.generators.get(req.generator.id);
      if (!generator) throw new StageError("generator", `unknown generator ${req.generator.id}`);
      const model = await generator.generate(req.generator.params, ctx);
      modelPath = model.path;

      // ── Slice ──────────────────────────────────────────────────
      stage = "slicer";
      currentState = "slicing";
      await bus.publish(jobId, "slicing", { stage });
      const slicer = registry.slicers.get(jobTarget.slicerId);
      if (!slicer) throw new StageError("slicer", `unknown slicer ${jobTarget.slicerId}`);
      const profileForSlice = await resolveProfileForSlice(jobTarget, workDir);
      ctx.log(`profile ${jobTarget.profileId}: ${profileForSlice.source}`);
      const gcode = await slicer
        .slice(model, profileForSlice.profile, ctx)
        .finally(async () => {
          // Profile JSON is temporary input, unlike model/gcode artifacts. Cleanup is
          // best-effort and must not turn a successful slice into a failed print.
          await profileForSlice.cleanup().catch((error) =>
            ctx.log(`warning: failed to clean materialized profile: ${(error as Error).message}`),
          );
        });
      gcodePath = gcode.path;

      // ── Transport ──────────────────────────────────────────────
      stage = "transport";
      currentState = "transferring";
      await bus.publish(jobId, "transferring", { stage });
      const transport = registry.transports.get(jobTarget.transportId);
      if (!transport) throw new StageError("transport", `unknown transport ${jobTarget.transportId}`);
      const target = await resolveTarget(jobTarget.printerId, jobTarget.transportId);
      const handle = await transport.submit(gcode, target, ctx);

      currentState = "printing";
      for await (const status of transport.status(handle)) {
        if (status.state === "printing") {
          await bus.publish(jobId, "printing", { stage, progress: status.progress, message: status.message });
        } else if (status.state === "done") {
          break;
        } else if (status.state === "failed" || status.state === "canceled") {
          throw new StageError("transport", status.message ?? status.state);
        }
      }

      await bus.publish(jobId, "done", { stage });
      // Durable history: settled record lives in SQLite (Redis snapshot expires).
      recordTerminal(jobId, req, "done", { modelPath, gcodePath });
    } catch (err) {
      const se =
        err instanceof StageError
          ? err
          : new StageError(stage, (err as Error).message, { cause: err });
      await bus.publish(jobId, "failed", { stage: se.stage, error: { stage: se.stage, reason: se.reason } });
      recordTerminal(jobId, req, "failed", { stage: se.stage, reason: se.reason });
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
      throw se;
    } finally {
      await control.quit();
    }
  },
  { connection, concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2) },
);

worker.on("ready", () => console.log("conveyor worker ready"));
worker.on("failed", (job, err) => console.error(`job ${job?.id} failed:`, err.message));

/** Resolve the PrinterTarget (incl. server-only secrets) from the SQLite store. */
async function resolveTarget(printerId: string, transportId: string): Promise<PrinterTarget> {
  const p = dbGetPrinter(openDb(), printerId);
  if (!p) throw new StageError("transport", `unknown printer ${printerId}`);
  return { id: p.id, transportId: p.transportId, address: p.address, secrets: p.secrets };
}

/** Persist the settled job record; never throws into the pipeline. */
function recordTerminal(
  jobId: string,
  req: JobRequest,
  state: "done" | "failed",
  extra: { modelPath?: string; gcodePath?: string; stage?: Stage; reason?: string },
): void {
  try {
    dbRecordJob(openDb(), {
      id: jobId,
      generatorId: req.generator.id,
      params: req.generator.params,
      printerId: req.printerId,
      profileId: req.profileId,
      state,
      stage: extra.stage ?? null,
      error: extra.stage && extra.reason ? { stage: extra.stage, reason: extra.reason } : undefined,
      modelPath: extra.modelPath,
      gcodePath: extra.gcodePath,
    });
  } catch (e) {
    console.error(`[${jobId}] failed to record job history:`, (e as Error).message);
  }
}
