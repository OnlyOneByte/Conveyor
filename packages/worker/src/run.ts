import {
  computeStageTimings,
  type JobRequest,
  type JobState,
  type JobStatusEvent,
  type JobTarget,
  type PrinterTarget,
  type PrintHandle,
  type Registry,
  type Stage,
  type StageCtx,
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
  aborted: Promise<never>;
  ctx: StageCtx;
  stage: Stage;
  state: JobState;
  enters: { stage: Stage; at: number }[];
  modelPath?: string;
  gcodePath?: string;
  print?: PrintAttempt;
}

export function messageOf(err: unknown): string {
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

export function createRun(opts: RunJobOptions, deps: PipelineDeps): Run {
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

export function race<T>(run: Run, p: Promise<T>): Promise<T> {
  return Promise.race([p, run.aborted]);
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
