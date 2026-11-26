import type { Stage } from "./plugins.js";

export interface StageCtx {
  jobId: string;
  workDir: string;
  report(progress: number, message?: string): void;
  reportUpload?(bytesSent: number, bytesTotal: number): void;
  confirmStart?(): Promise<void>;
  signal: AbortSignal;
  log(msg: string): void;
}

export const printerFileName = (jobId: string): string =>
  `conveyor-${jobId.replace(/[^A-Za-z0-9-]/g, "_")}.gcode`;

const PRINTER_FILE = /^conveyor-[A-Za-z0-9_-]+\.gcode$/;

const baseName = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

export function filesToPrune(
  paths: readonly string[],
  keep: ReadonlySet<string>,
  printing: string | undefined,
): string[] {
  const busy = printing === undefined ? undefined : baseName(printing);
  return paths.filter((path) => {
    const name = baseName(path);
    return PRINTER_FILE.test(name) && !keep.has(name) && name !== busy;
  });
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

export class PrintMayHaveStartedError extends StageError {
  constructor(reason: string, options?: { cause?: unknown }) {
    super("transport", reason, options);
    this.name = "PrintMayHaveStartedError";
  }
}

export class PrintNotStartedError extends StageError {
  constructor(reason: string, options?: { cause?: unknown }) {
    super("transport", reason, options);
    this.name = "PrintNotStartedError";
  }
}

export type PrinterReadiness = "idle" | "printing" | "paused" | "error" | "unknown";

export function refuseUnlessIdle(transport: string, state: PrinterReadiness): void {
  if (state === "idle") return;
  if (state === "error")
    throw new PrintNotStartedError(`printer reports an error: ${transport} says error`);
  if (state === "unknown")
    throw new PrintNotStartedError(`printer state unknown: ${transport} gave no usable state`);
  throw new PrintNotStartedError(`printer is busy: ${transport} reports it ${state}`);
}
