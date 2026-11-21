import { rm } from "node:fs/promises";
import { basename } from "node:path";
import {
  computeStageTimings,
  type GcodeArtifact,
  type JobRequest,
  type JobState,
  type JobStatusEvent,
  type JobTarget,
  type ModelArtifact,
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
  state: TerminalState;
  modelPath?: string;
  gcodePath?: string;
  stage?: Stage;
  reason?: string;
  timings?: StageTiming[];
}

export interface PublishExtra {
  stage?: Stage | null;
  progress?: number;
  message?: string;
  error?: JobStatusEvent["error"];
  timings?: StageTiming[];
}

export interface PipelineDeps {
  registry: Registry;
  publish(jobId: string, state: JobState, extra?: PublishExtra): Promise<unknown>;
  record(jobId: string, req: JobRequest, outcome: TerminalRecord): void;
  resolveJobTarget(req: JobRequest): JobTarget | null;
  resolvePrinter(printerId: string): Promise<PrinterTarget>;
  resolveProfile(target: JobTarget, workDir: string): Promise<ProfileForSlice>;
  cancelRequested(): Promise<boolean>;
  log(msg: string): void;
}

export interface RunJobOptions {
  jobId: string;
  req: JobRequest;
  workDir: string;
  controller: AbortController;
  cancelPollMs?: number;
}

export class JobCanceledError extends Error {
  constructor() {
    super("job canceled");
    this.name = "JobCanceledError";
  }
}

interface PrintAttempt {
  transport: TransportPlugin;
  printer: PrinterTarget;
  ref: string;
  handle?: PrintHandle;
}

interface Run {
  opts: RunJobOptions;
  deps: PipelineDeps;
  signal: AbortSignal;
  aborted: Promise<never>;
  ctx: StageCtx;
  stage: Stage;
  state: JobState;
  enters: { stage: Stage; at: number }[];
  modelPath?: string;
  gcodePath?: string;
  print?: PrintAttempt;
}

const DEFAULT_CANCEL_POLL_MS = 2000;

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function abortPromise(signal: AbortSignal): Promise<never> {
  const p = new Promise<never>((_, reject) => {
    if (signal.aborted) reject(new JobCanceledError());
    else signal.addEventListener("abort", () => reject(new JobCanceledError()), { once: true });
  });
  p.catch(() => {});
  return p;
}

function createRun(opts: RunJobOptions, deps: PipelineDeps): Run {
  const signal = opts.controller.signal;
  const run: Run = {
    opts,
    deps,
    signal,
    aborted: abortPromise(signal),
    stage: "generator",
    state: "generating",
    enters: [],
    ctx: {
      jobId: opts.jobId,
      workDir: opts.workDir,
      signal,
      report: (progress, message) =>
        void deps.publish(opts.jobId, run.state, { stage: run.stage, progress, message }),
      log: deps.log,
    },
  };
  return run;
}

function race<T>(run: Run, p: Promise<T>): Promise<T> {
  return Promise.race([p, run.aborted]);
}

async function checkpoint(run: Run): Promise<void> {
  if (!run.signal.aborted && (await run.deps.cancelRequested())) run.opts.controller.abort();
  if (run.signal.aborted) throw new JobCanceledError();
}

async function enterStage(run: Run, stage: Stage, state: JobState): Promise<void> {
  await checkpoint(run);
  run.stage = stage;
  run.state = state;
  run.enters.push({ stage, at: Date.now() });
  await run.deps.publish(run.opts.jobId, state, {
    stage,
    timings: computeStageTimings(run.enters),
  });
}

async function generateStage(run: Run): Promise<ModelArtifact> {
  await enterStage(run, "generator", "generating");
  const { req } = run.opts;
  const generator = run.deps.registry.generators.get(req.generator.id);
  if (!generator) throw new StageError("generator", `unknown generator ${req.generator.id}`);
  const model = await race(run, generator.generate(req.generator.params, run.ctx));
  run.modelPath = model.path;
  return model;
}

async function sliceStage(
  run: Run,
  target: JobTarget,
  model: ModelArtifact,
): Promise<GcodeArtifact> {
  await enterStage(run, "slicer", "slicing");
  const slicer = run.deps.registry.slicers.get(target.slicerId);
  if (!slicer) throw new StageError("slicer", `unknown slicer ${target.slicerId}`);
  const profile = await run.deps.resolveProfile(target, run.opts.workDir);
  run.ctx.log(`profile ${target.profileId}: ${profile.source}`);
  const sliced = slicer
    .slice(model, profile.profile, run.ctx)
    .finally(() =>
      profile
        .cleanup()
        .catch((error) =>
          run.ctx.log(`warning: failed to clean materialized profile: ${messageOf(error)}`),
        ),
    );
  const gcode = await race(run, sliced);
  run.gcodePath = gcode.path;
  return gcode;
}

async function printStage(
  run: Run,
  target: JobTarget,
  gcode: GcodeArtifact,
): Promise<"done" | "canceled"> {
  await enterStage(run, "transport", "transferring");
  const transport = run.deps.registry.transports.get(target.transportId);
  if (!transport) throw new StageError("transport", `unknown transport ${target.transportId}`);
  const printer = await run.deps.resolvePrinter(target.printerId);
  const attempt: PrintAttempt = { transport, printer, ref: basename(gcode.path) };
  run.print = attempt;
  attempt.handle = await transport.submit(gcode, printer, run.ctx);
  await checkpoint(run);
  run.state = "printing";
  return watchPrint(run, transport, attempt.handle);
}

function pollCancelFlag(run: Run): () => void {
  const timer = setInterval(() => {
    void run.deps.cancelRequested().then(
      (requested) => requested && run.opts.controller.abort(),
      () => {},
    );
  }, run.opts.cancelPollMs ?? DEFAULT_CANCEL_POLL_MS);
  return () => clearInterval(timer);
}

async function watchPrint(
  run: Run,
  transport: TransportPlugin,
  handle: PrintHandle,
): Promise<"done" | "canceled"> {
  const stopPolling = pollCancelFlag(run);
  const statuses = transport.status(handle, run.signal)[Symbol.asyncIterator]();
  try {
    while (true) {
      const next = await race(run, statuses.next());
      if (next.done || next.value.state === "done") return "done";
      const status = next.value;
      if (status.state === "canceled") return "canceled";
      if (status.state === "failed") {
        throw new StageError("transport", status.message ?? status.state);
      }
      if (status.state === "printing") {
        await run.deps.publish(run.opts.jobId, "printing", {
          stage: run.stage,
          progress: status.progress,
          message: status.message,
          timings: computeStageTimings(run.enters),
        });
      }
      await checkpoint(run);
    }
  } finally {
    stopPolling();
    void statuses.return?.()?.catch(() => {});
  }
}

function fallbackHandle(attempt: PrintAttempt): PrintHandle {
  const { transport, printer, ref } = attempt;
  return (
    transport.handleFor?.(printer, ref) ?? {
      transportId: transport.id,
      printerId: printer.id,
      ref,
      address: printer.address,
    }
  );
}

async function stopPrinter(run: Run): Promise<string | undefined> {
  const attempt = run.print;
  if (!attempt) return undefined;
  const { transport } = attempt;
  if (!transport.cancel)
    return `cancel requested but transport ${transport.id} cannot stop a print`;
  try {
    await transport.cancel(attempt.handle ?? fallbackHandle(attempt));
    run.ctx.log(`transport ${transport.id} cancel sent`);
    return undefined;
  } catch (e) {
    const reason = `cancel requested but the printer did not confirm the stop: ${messageOf(e)}`;
    run.ctx.log(reason);
    return reason;
  }
}

async function cleanup(run: Run): Promise<void> {
  await rm(run.opts.workDir, { recursive: true, force: true }).catch(() => {});
}

async function settleDone(run: Run): Promise<TerminalState> {
  const timings = computeStageTimings(run.enters, Date.now());
  await run.deps.publish(run.opts.jobId, "done", { stage: run.stage, timings });
  run.deps.record(run.opts.jobId, run.opts.req, {
    state: "done",
    modelPath: run.modelPath,
    gcodePath: run.gcodePath,
    timings,
  });
  return "done";
}

async function settleCanceled(run: Run, message?: string): Promise<TerminalState> {
  const timings = computeStageTimings(run.enters, Date.now());
  await run.deps.publish(run.opts.jobId, "canceled", { stage: run.stage, message, timings });
  run.deps.record(run.opts.jobId, run.opts.req, {
    state: "canceled",
    stage: run.stage,
    timings,
  });
  await cleanup(run);
  return "canceled";
}

async function settleFailed(run: Run, se: StageError): Promise<never> {
  const timings = computeStageTimings(run.enters, Date.now());
  await run.deps.publish(run.opts.jobId, "failed", {
    stage: se.stage,
    error: { stage: se.stage, reason: se.reason },
    timings,
  });
  run.deps.record(run.opts.jobId, run.opts.req, {
    state: "failed",
    stage: se.stage,
    reason: se.reason,
    timings,
  });
  await cleanup(run);
  throw se;
}

async function settleError(run: Run, err: unknown): Promise<TerminalState> {
  if (err instanceof JobCanceledError || run.signal.aborted) {
    const stopError = await stopPrinter(run);
    if (stopError) return settleFailed(run, new StageError("transport", stopError));
    return settleCanceled(run);
  }
  const se =
    err instanceof StageError ? err : new StageError(run.stage, messageOf(err), { cause: err });
  return settleFailed(run, se);
}

export async function runJob(opts: RunJobOptions, deps: PipelineDeps): Promise<TerminalState> {
  const run = createRun(opts, deps);
  try {
    await checkpoint(run);
    const target = deps.resolveJobTarget(opts.req);
    if (!target) {
      throw new StageError(
        "generator",
        `unknown printer ${opts.req.printerId} or profile ${opts.req.profileId}`,
      );
    }
    const model = await generateStage(run);
    const gcode = await sliceStage(run, target, model);
    const outcome = await printStage(run, target, gcode);
    if (outcome === "canceled") return await settleCanceled(run, "canceled on printer");
    return await settleDone(run);
  } catch (err) {
    return settleError(run, err);
  }
}
