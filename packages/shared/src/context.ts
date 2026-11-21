import type { Stage } from "./plugins.js";

export interface StageCtx {
  jobId: string;
  workDir: string;
  report(progress: number, message?: string): void;
  signal: AbortSignal;
  log(msg: string): void;
}

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
