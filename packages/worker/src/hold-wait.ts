import type { JobState } from "@conveyor/shared";
import { DelayedError, type Job } from "bullmq";

export const HOLD_RECHECK_MS = 5_000;

export const holdWaitMessage = (hold: string) => `waiting: the printer is on hold (${hold})`;

export type HeldJob = Pick<
  Job<unknown>,
  "id" | "timestamp" | "data" | "promote" | "moveToDelayed" | "getState"
>;

export interface HoldWaitDeps {
  held(printerId: string): string | null;
  canceled(jobId: string): Promise<boolean>;
  settleCanceled(jobId: string): Promise<void>;
  shownAs(jobId: string): Promise<{ state: JobState; message?: string } | undefined>;
  showQueued(jobId: string, message: string): Promise<void>;
  delayed(): Promise<HeldJob[]>;
  printerOf(job: HeldJob): string;
}

async function promote(job: HeldJob): Promise<void> {
  try {
    await job.promote();
  } catch (err) {
    if ((await job.getState()) === "delayed") throw err;
  }
}

async function promoteOlder(job: HeldJob, printerId: string, deps: HoldWaitDeps) {
  const older = (await deps.delayed())
    .filter((other) => other.id !== job.id && other.timestamp < job.timestamp)
    .filter((other) => deps.printerOf(other) === printerId)
    .sort((a, b) => a.timestamp - b.timestamp);
  for (const other of older) await promote(other);
  return older.length > 0;
}

export async function waitOutHold(
  job: HeldJob,
  token: string | undefined,
  printerId: string,
  deps: HoldWaitDeps,
): Promise<"run" | "canceled"> {
  const jobId = job.id ?? "";
  const hold = deps.held(printerId);
  if (hold === null) {
    if (!(await promoteOlder(job, printerId, deps))) return "run";
    await job.moveToDelayed(Date.now(), token);
    throw new DelayedError();
  }
  if (await deps.canceled(jobId)) {
    await deps.settleCanceled(jobId);
    return "canceled";
  }
  const message = holdWaitMessage(hold);
  const shown = await deps.shownAs(jobId);
  if (shown?.state !== "queued" || shown.message !== message) await deps.showQueued(jobId, message);
  await job.moveToDelayed(Date.now() + HOLD_RECHECK_MS, token);
  throw new DelayedError();
}
