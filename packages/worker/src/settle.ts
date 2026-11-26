import { existsSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  computeStageTimings,
  type Note,
  type NoteText,
  note,
  notesText,
  noteText,
  StageError,
} from "@conveyor/shared";
import { ENGINE_LOG } from "@conveyor/shared/node";
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

async function stopPrinter(run: Run): Promise<Note | undefined> {
  const attempt = run.print;
  if (!attempt || attempt.notStarted) return undefined;
  const { transport } = attempt;
  if (!transport.cancel) return note("cannotStop", `${transport.id} cannot stop a print`);
  try {
    await transport.cancel(attempt.handle ?? fallbackHandle(attempt), attempt.printer);
    run.ctx.log(`transport ${transport.id} cancel sent`);
    return undefined;
  } catch (e) {
    const reason = note("stopUnconfirmed", messageOf(e));
    run.ctx.log(noteText(reason));
    return reason;
  }
}

const noted = (run: Run, first?: Note): NoteText | undefined =>
  notesText(first ? [first, ...run.notes] : run.notes);

const removeTree = (path: string) => rm(path, { recursive: true, force: true });

async function clearWorkDir(workDir: string, keepEngineLog: boolean): Promise<void> {
  if (!keepEngineLog || !existsSync(join(workDir, ENGINE_LOG))) return removeTree(workDir);
  const names = await readdir(workDir);
  await Promise.all(names.filter((n) => n !== ENGINE_LOG).map((n) => removeTree(join(workDir, n))));
}

async function cleanup(run: Run, keepEngineLog = false): Promise<void> {
  run.deps.queue?.checkLease();
  const failure = await clearWorkDir(run.opts.workDir, keepEngineLog).then(
    () => undefined,
    (err: unknown) => note("workDirNotRemoved", messageOf(err)),
  );
  if (failure) run.notes.push(failure);
}

async function writeHistory(
  run: Run,
  outcome: TerminalRecord,
): Promise<{ error: Error; note: Note } | undefined> {
  const baseMs = run.opts.historyRetryMs ?? DEFAULT_HISTORY_RETRY_MS;
  let lastError: unknown;
  for (let attempt = 0; attempt < HISTORY_ATTEMPTS; attempt++) {
    if (attempt > 0) await delay(baseMs * 2 ** (attempt - 1));
    try {
      run.deps.record(run.opts.jobId, run.opts.req, { ...outcome, filament: run.filament });
      return undefined;
    } catch (err) {
      lastError = err;
    }
  }
  const lost = note("historyNotRecorded", `${HISTORY_ATTEMPTS} attempts: ${messageOf(lastError)}`);
  return { error: new Error(noteText(lost), { cause: lastError }), note: lost };
}

async function recordThenPublish(
  run: Run,
  outcome: TerminalRecord,
  extra: () => PublishExtra,
): Promise<Error | undefined> {
  const failure = await writeHistory(run, outcome);
  if (failure) run.notes.push(failure.note);
  await run.deps.publish(run.opts.jobId, outcome.state, extra());
  return failure?.error;
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
  stopError?: Note,
  message?: Note,
): Promise<TerminalState> {
  await cleanup(run, stopError !== undefined);
  const failure = await writeHistory(run, {
    state: stopError === undefined ? "canceled" : "failed",
    stage: stopError === undefined ? run.stage : "transport",
    modelPath: run.modelPath,
    gcodePath: run.gcodePath,
    notes: noted(run, stopError ?? message),
    timings: computeStageTimings(run.enters, Date.now()),
  });
  const state = await queue.settleCancel(stopError === undefined);
  if (failure) throw failure.error;
  return state;
}

async function settleResumeFailed(
  run: Run,
  queue: QueueHooks,
  reason: Note,
): Promise<TerminalState> {
  await cleanup(run, true);
  const failure = await writeHistory(run, { state: "failed", notes: noted(run, reason) });
  const state = await queue.failResume();
  if (failure) throw failure.error;
  return state;
}

export async function settleCanceled(run: Run, message?: Note): Promise<TerminalState> {
  if (run.deps.queue) return settleQueuedCancel(run, run.deps.queue, undefined, message);
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
  await cleanup(run, true);
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
  if (lost instanceof LeaseLostError) throw lost;
  if (err instanceof ResumeFailedError && run.deps.queue) {
    return settleResumeFailed(run, run.deps.queue, err.note);
  }
  if (err instanceof JobCanceledError || run.signal.aborted) {
    const stopError = await stopPrinter(run);
    if (run.deps.queue) return settleQueuedCancel(run, run.deps.queue, stopError);
    if (stopError) return settleFailed(run, new StageError("transport", noteText(stopError)));
    return settleCanceled(run);
  }
  const se =
    err instanceof StageError ? err : new StageError(run.stage, messageOf(err), { cause: err });
  return settleFailed(run, se);
}
