import type { Stage } from "./plugins.js";

/** Per-job execution context handed to every stage by the worker. */
export interface StageCtx {
  jobId: string;
  /** absolute working dir under the shared /data volume for this job */
  workDir: string;
  /** report progress within a stage (0..1) — surfaces on the status bus */
  report(progress: number, message?: string): void;
  /** cooperative cancellation; adapters pass this to spawned engines/fetch */
  signal: AbortSignal;
  log(msg: string): void;
}

/** Typed failure thrown by a stage adapter; carries which stage failed and why. */
export class StageError extends Error {
  readonly stage: Stage;
  readonly reason: string;
  constructor(stage: Stage, reason: string, options?: { cause?: unknown }) {
    super(`[${stage}] ${reason}`, options);
    this.name = "StageError";
    this.stage = stage;
    this.reason = reason;
  }
}
