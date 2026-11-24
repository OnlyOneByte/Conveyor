import {
  computeStageTimings,
  type FilamentUse,
  type JobRequest,
  type JobState,
  type JobStatusEvent,
  type JobTarget,
  type PrinterTarget,
  type PrintHandle,
  type Registry,
  type Stage,
  type StageCtx,
  type StageError,
  type StageTiming,
  type TransportPlugin,
} from "@conveyor/shared";
import type { ResumeState } from "@conveyor/shared/queue";
import type { ProfileForSlice } from "./profile.js";

export type TerminalState = "done" | "failed" | "canceled";

export interface TerminalRecord {
  state: TerminalState;
  modelPath?: string;
  gcodePath?: string;
  filament?: FilamentUse;
  stage?: Stage;
  reason?: string;
  notes?: string;
  timings?: StageTiming[];
}

export interface PublishExtra {
  stage?: Stage | null;
  progress?: number;
  message?: string;
  error?: JobStatusEvent["error"];
  timings?: StageTiming[];
  bytesSent?: number;
  bytesTotal?: number;
}

export type SlotResult = "taken" | "canceled";

export interface QueueHooks {
  takeSlot(signal: AbortSignal): Promise<SlotResult>;
  markSubmitted(handle: PrintHandle): Promise<void>;
  settleCancel(stopConfirmed: boolean): Promise<TerminalState>;
  resumeState(): ResumeState | null;
  failResume(): Promise<TerminalState>;
}

export interface PipelineDeps {
  registry: Registry;
  publish(jobId: string, state: JobState, extra?: PublishExtra): Promise<unknown>;
  record(jobId: string, req: JobRequest, outcome: TerminalRecord): void;
  resolveJobTarget(req: JobRequest): JobTarget | null;
  resolvePrinter(printerId: string): Promise<PrinterTarget>;
  printerSeen(printerId: string): void;
  readFilament(gcodePath: string): Promise<FilamentUse | undefined>;
  resolveProfile(target: JobTarget, workDir: string): Promise<ProfileForSlice>;
  cancelRequested(): Promise<boolean>;
  log(msg: string): void;
  queue?: QueueHooks;
}

export interface RunJobOptions {
  jobId: string;
  req: JobRequest;
  workDir: string;
  controller: AbortController;
  cancelPollMs?: number;
  streamCloseMs?: number;
  historyRetryMs?: number;
}

export class JobCanceledError extends Error {
  constructor() {
    super("job canceled");
    this.name = "JobCanceledError";
  }
}

export class LeaseLostError extends Error {
  constructor() {
    super("job lease lost");
    this.name = "LeaseLostError";
  }
}

export interface PrintAttempt {
  transport: TransportPlugin;
  printer: PrinterTarget;
  ref: string;
  handle?: PrintHandle;
  notStarted?: boolean;
}

export interface Run {
  opts: RunJobOptions;
  deps: PipelineDeps;
  signal: AbortSignal;
  halt: AbortController;
  ctx: StageCtx;
  stage: Stage;
  state: JobState;
  enters: { stage: Stage; at: number }[];
  modelPath?: string;
  gcodePath?: string;
  filament?: FilamentUse;
  print?: PrintAttempt;
  notes: string[];
}

export function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function haltOn(signal: AbortSignal): AbortController {
  const halt = new AbortController();
  const cancel = () => halt.abort(new JobCanceledError());
  if (signal.aborted) cancel();
  else signal.addEventListener("abort", cancel, { once: true });
  return halt;
}

export function createRun(opts: RunJobOptions, deps: PipelineDeps): Run {
  const signal = opts.controller.signal;
  const run: Run = {
    opts,
    deps,
    signal,
    halt: haltOn(signal),
    stage: "generator",
    state: "generating",
    enters: [],
    notes: [],
    ctx: {
      jobId: opts.jobId,
      workDir: opts.workDir,
      signal,
      report: (progress, message) =>
        void deps.publish(opts.jobId, run.state, { stage: run.stage, progress, message }),
      reportUpload: (bytesSent, bytesTotal) =>
        void deps.publish(opts.jobId, run.state, {
          stage: run.stage,
          progress: bytesTotal === 0 ? 1 : bytesSent / bytesTotal,
          bytesSent,
          bytesTotal,
        }),
      log: deps.log,
    },
  };
  return run;
}

export function failRun(run: Run, err: StageError): void {
  if (!run.halt.signal.aborted) run.halt.abort(err);
}

export function race<T>(run: Run, p: Promise<T>): Promise<T> {
  const halt = run.halt.signal;
  return new Promise<T>((resolve, reject) => {
    const onHalt = () => reject(halt.reason);
    p.then(resolve, reject).finally(() => halt.removeEventListener("abort", onHalt));
    if (halt.aborted) onHalt();
    else halt.addEventListener("abort", onHalt, { once: true });
  });
}

export async function checkpoint(run: Run): Promise<void> {
  if (!run.signal.aborted && (await run.deps.cancelRequested())) run.opts.controller.abort();
  if (run.signal.aborted) throw new JobCanceledError();
}

export async function enterStage(run: Run, stage: Stage, state: JobState): Promise<void> {
  await checkpoint(run);
  run.stage = stage;
  run.state = state;
  run.enters.push({ stage, at: Date.now() });
  await run.deps.publish(run.opts.jobId, state, {
    stage,
    timings: computeStageTimings(run.enters),
  });
}
