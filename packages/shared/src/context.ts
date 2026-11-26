import type { Stage } from "./plugins.js";

export interface StageCtx {
  jobId: string;
  workDir: string;
  report(progress: number, message?: string): void;
  reportUpload?(bytesSent: number, bytesTotal: number): void;
  signal: AbortSignal;
  log(msg: string): void;
}

export const printerFileName = (jobId: string): string =>
  `conveyor-${jobId.replace(/[^A-Za-z0-9-]/g, "_")}.gcode`;

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

export class PrintNotStartedError extends StageError {
  constructor(reason: string, options?: { cause?: unknown }) {
    super("transport", reason, options);
    this.name = "PrintNotStartedError";
  }
}
