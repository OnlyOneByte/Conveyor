import { rm } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { computeStageTimings, StageError } from "@conveyor/shared";
import { fallbackHandle, ResumeFailedError } from "./print.js";
import {
  JobCanceledError,
  LeaseLostError,
  messageOf,
  type PublishExtra,
  type QueueHooks,
  type Run,
  type TerminalRecord,
  type TerminalState,
} from "./run.js";

const HISTORY_ATTEMPTS = 3;
const DEFAULT_HISTORY_RETRY_MS = 250;

async function stopPrinter(run: Run): Promise<string | undefined> {
  const attempt = run.print;
  if (!attempt || attempt.notStarted) return undefined;
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

function noted(run: Run, text?: string): string | undefined {
  const parts = text ? [text, ...run.notes] : run.notes;
  return parts.length ? parts.join("; ") : undefined;
}

async function cleanup(run: Run): Promise<void> {
  const failure = await rm(run.opts.workDir, { recursive: true, force: true }).then(
    () => undefined,
    (err: unknown) => `work dir not removed: ${messageOf(err)}`,
  );
  if (failure) run.notes.push(failure);
}

async function writeHistory(run: Run, outcome: TerminalRecord): Promise<Error | undefined> {
  const baseMs = run.opts.historyRetryMs ?? DEFAULT_HISTORY_RETRY_MS;
  let lastError: unknown;
  for (let attempt = 0; attempt < HISTORY_ATTEMPTS; attempt++) {
    if (attempt > 0) await delay(baseMs * 2 ** (attempt - 1));
    try {
      run.deps.record(run.opts.jobId, run.opts.req, outcome);
      return undefined;
    } catch (err) {
      lastError = err;
    }
  }
  return new Error(
    `history not recorded after ${HISTORY_ATTEMPTS} attempts: ${messageOf(lastError)}`,
    { cause: lastError },
  );
}

async function recordThenPublish(
  run: Run,
  outcome: TerminalRecord,
  extra: () => PublishExtra,
): Promise<Error | undefined> {
  const failure = await writeHistory(run, outcome);
  if (failure) run.notes.push(failure.message);
  await run.deps.publish(run.opts.jobId, outcome.state, extra());
  return failure;
}

export async function settleDone(run: Run): Promise<TerminalState> {
  const timings = computeStageTimings(run.enters, Date.now());
  const failure = await recordThenPublish(
    run,
    {
      state: "done",
      modelPath: run.modelPath,
      gcodePath: run.gcodePath,
      notes: noted(run),
      timings,
    },
    () => ({ stage: run.stage, message: noted(run), timings }),
  );
  if (failure) throw failure;
  return "done";
}

async function settleQueuedCancel(
  run: Run,
  queue: QueueHooks,
  stopError?: string,
): Promise<TerminalState> {
  await cleanup(run);
  const failure = await writeHistory(run, {
    state: stopError === undefined ? "canceled" : "failed",
    modelPath: run.modelPath,
    gcodePath: run.gcodePath,
    notes: noted(run, stopError),
  });
  const state = await queue.settleCancel(stopError === undefined);
  if (failure) throw failure;
  return state;
}

async function settleResumeFailed(
  run: Run,
  queue: QueueHooks,
  reason: string,
): Promise<TerminalState> {
  await cleanup(run);
  const failure = await writeHistory(run, { state: "failed", notes: noted(run, reason) });
  const state = await queue.failResume();
  if (failure) throw failure;
  return state;
}

export async function settleCanceled(run: Run, message?: string): Promise<TerminalState> {
  if (run.deps.queue) return settleQueuedCancel(run, run.deps.queue);
  await cleanup(run);
  const timings = computeStageTimings(run.enters, Date.now());
  const failure = await recordThenPublish(
    run,
    { state: "canceled", stage: run.stage, notes: noted(run), timings },
    () => ({ stage: run.stage, message: noted(run, message), timings }),
  );
  if (failure) throw failure;
  return "canceled";
}

async function settleFailed(run: Run, se: StageError): Promise<never> {
  await cleanup(run);
  const timings = computeStageTimings(run.enters, Date.now());
  const failure = await recordThenPublish(
    run,
    { state: "failed", stage: se.stage, reason: se.reason, notes: noted(run), timings },
    () => ({
      stage: se.stage,
      error: { stage: se.stage, reason: se.reason },
      message: noted(run),
      timings,
    }),
  );
  if (failure) throw new AggregateError([se, failure], `${se.message}; ${failure.message}`);
  throw se;
}

export async function settleError(run: Run, err: unknown): Promise<TerminalState> {
  const lost = err instanceof LeaseLostError ? err : run.signal.reason;
  if (lost instanceof LeaseLostError) {
    await cleanup(run);
    throw lost;
  }
  if (err instanceof ResumeFailedError && run.deps.queue) {
    return settleResumeFailed(run, run.deps.queue, err.message);
  }
  if (err instanceof JobCanceledError || run.signal.aborted) {
    const stopError = await stopPrinter(run);
    if (run.deps.queue) return settleQueuedCancel(run, run.deps.queue, stopError);
    if (stopError) return settleFailed(run, new StageError("transport", stopError));
    return settleCanceled(run);
  }
  const se =
    err instanceof StageError ? err : new StageError(run.stage, messageOf(err), { cause: err });
  return settleFailed(run, se);
}
