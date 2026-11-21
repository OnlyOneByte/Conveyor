import { rm } from "node:fs/promises";
import { basename } from "node:path";
import {
  computeStageTimings,
  type GcodeArtifact,
  type JobRequest,
  type JobState,
  type JobStatusEvent,
  type JobTarget,
  type PrinterTarget,
  type PrintHandle,
  type Registry,
  type Stage,
  type StageCtx,
  StageError,
  type StageTiming,
  type TransportPlugin,
} from "@conveyor/shared";
import type { ProfileForSlice } from "./profile.js";

export type TerminalState = "done" | "failed" | "canceled";

export interface TerminalRecord {
  modelPath?: string;
  gcodePath?: string;
  stage?: Stage;
  reason?: string;
  timings?: StageTiming[];
}

export interface PipelineDeps {
  registry: Registry;
  publish(
    jobId: string,
    state: JobState,
    extra?: {
      stage?: Stage | null;
      progress?: number;
      message?: string;
      error?: JobStatusEvent["error"];
      timings?: StageTiming[];
    },
  ): Promise<unknown>;
  record(jobId: string, req: JobRequest, state: TerminalState, extra: TerminalRecord): void;
  resolveJobTarget(req: JobRequest): JobTarget | null;
  resolvePrinter(printerId: string): Promise<PrinterTarget>;
  resolveProfile(target: JobTarget, workDir: string): Promise<ProfileForSlice>;
  cancelRequested(): Promise<boolean>;
  log(msg: string): void;
}

export class JobCanceledError extends Error {
  constructor() {
    super("job canceled");
    this.name = "JobCanceledError";
  }
}

function abortPromise(signal: AbortSignal): Promise<never> {
  const p = new Promise<never>((_, reject) => {
    if (signal.aborted) reject(new JobCanceledError());
    else signal.addEventListener("abort", () => reject(new JobCanceledError()), { once: true });
  });
  p.catch(() => {});
  return p;
}

export async function runJob(
  jobId: string,
  req: JobRequest,
  workDir: string,
  controller: AbortController,
  deps: PipelineDeps,
): Promise<TerminalState> {
  const signal = controller.signal;
  const aborted = abortPromise(signal);
  const race = <T>(p: Promise<T>): Promise<T> => Promise.race([p, aborted]);

  let stage: Stage = "generator";
  let currentState: JobState = "generating";
  let modelPath: string | undefined;
  let gcodePath: string | undefined;
  let transport: TransportPlugin | undefined;
  let printer: PrinterTarget | undefined;
  let gcode: GcodeArtifact | undefined;
  let handle: PrintHandle | undefined;
  const stageEnters: { stage: Stage; at: number }[] = [];
  const enterStage = (s: Stage): StageTiming[] => {
    stageEnters.push({ stage: s, at: Date.now() });
    return computeStageTimings(stageEnters);
  };

  const checkpoint = async () => {
    if (!signal.aborted && (await deps.cancelRequested())) controller.abort();
    if (signal.aborted) throw new JobCanceledError();
  };

  const ctx: StageCtx = {
    jobId,
    workDir,
    signal,
    report: (progress, message) =>
      void deps.publish(jobId, currentState, { stage, progress, message }),
    log: deps.log,
  };

  try {
    await checkpoint();
    const jobTarget = deps.resolveJobTarget(req);
    if (!jobTarget) {
      throw new StageError(
        "generator",
        `unknown printer ${req.printerId} or profile ${req.profileId}`,
      );
    }

    stage = "generator";
    currentState = "generating";
    await deps.publish(jobId, "generating", { stage, timings: enterStage("generator") });
    const generator = deps.registry.generators.get(req.generator.id);
    if (!generator) throw new StageError("generator", `unknown generator ${req.generator.id}`);
    const model = await race(generator.generate(req.generator.params, ctx));
    modelPath = model.path;

    await checkpoint();
    stage = "slicer";
    currentState = "slicing";
    await deps.publish(jobId, "slicing", { stage, timings: enterStage("slicer") });
    const slicer = deps.registry.slicers.get(jobTarget.slicerId);
    if (!slicer) throw new StageError("slicer", `unknown slicer ${jobTarget.slicerId}`);
    const profileForSlice = await deps.resolveProfile(jobTarget, workDir);
    ctx.log(`profile ${jobTarget.profileId}: ${profileForSlice.source}`);
    const sliced = await race(
      slicer.slice(model, profileForSlice.profile, ctx).finally(async () => {
        await profileForSlice
          .cleanup()
          .catch((error) =>
            ctx.log(`warning: failed to clean materialized profile: ${(error as Error).message}`),
          );
      }),
    );
    gcode = sliced;
    gcodePath = sliced.path;

    await checkpoint();
    stage = "transport";
    currentState = "transferring";
    await deps.publish(jobId, "transferring", { stage, timings: enterStage("transport") });
    transport = deps.registry.transports.get(jobTarget.transportId);
    if (!transport) throw new StageError("transport", `unknown transport ${jobTarget.transportId}`);
    printer = await deps.resolvePrinter(jobTarget.printerId);
    handle = await transport.submit(sliced, printer, ctx);
    await checkpoint();

    currentState = "printing";
    const statuses = transport.status(handle, signal)[Symbol.asyncIterator]();
    try {
      while (true) {
        const next = await race(statuses.next());
        if (next.done) break;
        const status = next.value;
        if (status.state === "printing") {
          await deps.publish(jobId, "printing", {
            stage,
            progress: status.progress,
            message: status.message,
            timings: computeStageTimings(stageEnters),
          });
        } else if (status.state === "done") {
          break;
        } else if (status.state === "canceled") {
          return await settleCanceled(status.message ?? "canceled on printer");
        } else if (status.state === "failed") {
          throw new StageError("transport", status.message ?? status.state);
        }
        if (signal.aborted) throw new JobCanceledError();
      }
    } finally {
      void statuses.return?.()?.catch(() => {});
    }
    await checkpoint();

    const doneTimings = computeStageTimings(stageEnters, Date.now());
    await deps.publish(jobId, "done", { stage, timings: doneTimings });
    deps.record(jobId, req, "done", { modelPath, gcodePath, timings: doneTimings });
    return "done";
  } catch (err) {
    if (err instanceof JobCanceledError || signal.aborted) {
      const stopError = await stopPrinter();
      if (stopError) return await settleFailed(new StageError("transport", stopError));
      return await settleCanceled();
    }
    const se =
      err instanceof StageError
        ? err
        : new StageError(stage, (err as Error).message, { cause: err });
    return await settleFailed(se);
  }

  async function stopPrinter(): Promise<string | undefined> {
    if (stage !== "transport" || !transport || !printer) return undefined;
    if (!transport.cancel) {
      return handle
        ? `cancel requested but transport ${transport.id} cannot stop a print`
        : undefined;
    }
    const target = handle ?? {
      transportId: transport.id,
      printerId: printer.id,
      ref: gcode ? basename(gcode.path) : "",
      address: printer.address,
    };
    try {
      await transport.cancel(target);
      ctx.log(`transport ${transport.id} cancel sent`);
      return undefined;
    } catch (e) {
      const reason = `cancel requested but the printer did not confirm the stop: ${(e as Error).message}`;
      ctx.log(reason);
      return handle ? reason : undefined;
    }
  }

  async function settleCanceled(message?: string): Promise<TerminalState> {
    const timings = computeStageTimings(stageEnters, Date.now());
    await deps.publish(jobId, "canceled", { stage, message, timings });
    deps.record(jobId, req, "canceled", { stage, timings });
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
    return "canceled";
  }

  async function settleFailed(se: StageError): Promise<TerminalState> {
    const timings = computeStageTimings(stageEnters, Date.now());
    await deps.publish(jobId, "failed", {
      stage: se.stage,
      error: { stage: se.stage, reason: se.reason },
      timings,
    });
    deps.record(jobId, req, "failed", { stage: se.stage, reason: se.reason, timings });
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
    throw se;
  }
}
