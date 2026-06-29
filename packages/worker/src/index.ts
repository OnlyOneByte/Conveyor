import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  JOB_QUEUE,
  StageError,
  type JobRequest,
  type StageCtx,
} from "@conveyor/shared";
import { buildRegistry } from "./registry.js";
import { StatusBus } from "./status.js";
import { resolveStation } from "./stations.js";

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

    try {
      const station = await resolveStation(req.stationId);

      // ── Generate ───────────────────────────────────────────────
      stage = "generator";
      currentState = "generating";
      await bus.publish(jobId, "generating", { stage });
      const generator = registry.generators.get(req.generator.id);
      if (!generator) throw new StageError("generator", `unknown generator ${req.generator.id}`);
      const model = await generator.generate(req.generator.params, ctx);

      // ── Slice ──────────────────────────────────────────────────
      stage = "slicer";
      currentState = "slicing";
      await bus.publish(jobId, "slicing", { stage });
      const slicer = registry.slicers.get(station.slicerId);
      if (!slicer) throw new StageError("slicer", `unknown slicer ${station.slicerId}`);
      const gcode = await slicer.slice(model, station.profileId, ctx);

      // ── Transport ──────────────────────────────────────────────
      stage = "transport";
      currentState = "transferring";
      await bus.publish(jobId, "transferring", { stage });
      const transport = registry.transports.get(station.transportId);
      if (!transport) throw new StageError("transport", `unknown transport ${station.transportId}`);
      const target = await resolveTarget(station.printerId, station.transportId);
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
    } catch (err) {
      const se =
        err instanceof StageError
          ? err
          : new StageError(stage, (err as Error).message, { cause: err });
      await bus.publish(jobId, "failed", { stage: se.stage, error: { stage: se.stage, reason: se.reason } });
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

// M0 stub — M2 resolves PrinterTarget (incl. secrets) from the SQLite store.
async function resolveTarget(printerId: string, transportId: string) {
  return { id: printerId, transportId, address: "127.0.0.1", secrets: {} };
}
