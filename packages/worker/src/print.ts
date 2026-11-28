import { basename } from "node:path";
import {
  computeStageTimings,
  exhaustive,
  type GcodeArtifact,
  type JobTarget,
  NOTE,
  type Note,
  note,
  noteText,
  type PrintHandle,
  PrintMayHaveStartedError,
  PrintNotStartedError,
  type PrintStatus,
  StageError,
} from "@conveyor/shared";
import { prunePrinter } from "./printer-files.js";
import {
  checkpoint,
  enterStage,
  failRun,
  JobCanceledError,
  messageOf,
  type PrintAttempt,
  type Run,
  race,
} from "./run.js";
import { canceled, stopWithin } from "./stop.js";

const DEFAULT_CANCEL_POLL_MS = 2000;
const DEFAULT_STREAM_CLOSE_MS = 5000;

export type PrintOutcome = "done" | "canceled";

export const RESUMED_MESSAGE = "resumed after worker restart";

export class ResumeFailedError extends Error {
  constructor(readonly note: Note) {
    super(noteText(note));
    this.name = "ResumeFailedError";
  }
}

export async function printStage(
  run: Run,
  target: JobTarget,
  gcode: GcodeArtifact,
): Promise<PrintOutcome> {
  const queue = run.deps.queue;
  if (queue) {
    await checkpoint(run);
    if ((await queue.takeSlot(run.signal)) === "canceled") throw new JobCanceledError();
  }
  const lock = queue ? undefined : run.deps.printerLock;
  if (!lock) return sendWatchAndPrune(run, target, gcode);
  await checkpoint(run);
  const held = await lock.acquire(target.printerId, run.signal);
  run.ctx.confirmStart = () => held.confirm();
  try {
    return await sendWatchAndPrune(run, target, gcode);
  } catch (err) {
    if (canceled(run, err)) await stopWithin(run);
    throw err;
  } finally {
    run.ctx.confirmStart = undefined;
    await held.release();
  }
}

async function sendWatchAndPrune(
  run: Run,
  target: JobTarget,
  gcode: GcodeArtifact,
): Promise<PrintOutcome> {
  try {
    return await sendAndWatch(run, target, gcode);
  } finally {
    await prunePrinter(run);
  }
}

async function sendAndWatch(
  run: Run,
  target: JobTarget,
  gcode: GcodeArtifact,
): Promise<PrintOutcome> {
  const queue = run.deps.queue;
  await enterStage(run, "transport", "transferring");
  const transport = run.deps.registry.transports.get(target.transportId);
  if (!transport) throw new StageError("transport", `unknown transport ${target.transportId}`);
  const printer = await run.deps.resolvePrinter(target.printerId);
  const attempt: PrintAttempt = { transport, printer, ref: basename(gcode.path) };
  run.print = attempt;
  attempt.handle = await transport.submit(gcode, printer, run.ctx).catch(async (err) => {
    if (err instanceof PrintNotStartedError) {
      attempt.notStarted = true;
      await queue?.markNotSubmitted();
    }
    if (err instanceof PrintMayHaveStartedError) {
      attempt.mayHaveStarted = true;
      run.deps.holdPrinter?.(run.opts.jobId, target.printerId, err.reason);
    }
    throw err;
  });
  await queue?.markSubmitted(attempt.handle);
  await checkpoint(run);
  run.state = "printing";
  return watchPrint(run, attempt, attempt.handle);
}

export async function resumePrint(run: Run, handle: PrintHandle): Promise<PrintOutcome> {
  const transport = run.deps.registry.transports.get(handle.transportId);
  if (!transport) throw new ResumeFailedError(note("resumeUnknownTransport", handle.transportId));
  const printer = await run.deps.resolvePrinter(handle.printerId).catch((err: unknown) => {
    throw new ResumeFailedError(note("resumeError", messageOf(err)));
  });
  const attempt: PrintAttempt = { transport, printer, ref: handle.ref, handle };
  run.print = attempt;
  await run.deps.publish(run.opts.jobId, "printing", {
    stage: "transport",
    message: RESUMED_MESSAGE,
    timings: computeStageTimings(run.enters),
  });
  return watchPrint(run, attempt, handle, true);
}

function pollCancelFlag(run: Run): () => void {
  const timer = setInterval(() => {
    void run.deps.cancelRequested().then(
      (requested) => requested && run.opts.controller.abort(),
      (err: unknown) =>
        failRun(run, new StageError("transport", `cancel-flag poll failed: ${messageOf(err)}`)),
    );
  }, run.opts.cancelPollMs ?? DEFAULT_CANCEL_POLL_MS);
  return () => clearInterval(timer);
}

async function handleStatus(run: Run, status: PrintStatus): Promise<PrintOutcome | undefined> {
  const { state } = status;
  switch (state) {
    case "done":
    case "canceled":
      return state;
    case "failed":
      throw new StageError("transport", status.message ?? state);
    case "printing":
      await run.deps.publish(run.opts.jobId, "printing", {
        stage: run.stage,
        progress: status.progress,
        message: status.message,
        print: status.print,
        timings: computeStageTimings(run.enters),
      });
      return undefined;
    case "transferring":
      return undefined;
    default:
      return exhaustive(state);
  }
}

async function closeStream(
  run: Run,
  statuses: AsyncIterator<PrintStatus>,
): Promise<Note | undefined> {
  if (!statuses.return) return undefined;
  const ms = run.opts.streamCloseMs ?? DEFAULT_STREAM_CLOSE_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const failure = await Promise.race([
    statuses.return().then(
      () => undefined,
      (err: unknown) => messageOf(err),
    ),
    new Promise<string>((resolve) => {
      timer = setTimeout(() => resolve(`timed out after ${ms} ms`), ms);
    }),
  ]);
  clearTimeout(timer);
  return failure === undefined ? undefined : note("streamNotClosed", failure);
}

export const SEEN_WRITE_FAILED = NOTE.seenNotRecorded;

function markPrinterSeen(run: Run, printerId: string): void {
  try {
    run.deps.printerSeen(printerId);
  } catch (err) {
    run.ctx.log(`job ${run.opts.jobId}: ${SEEN_WRITE_FAILED}: ${messageOf(err)}`);
    if (!run.notes.some(({ kind }) => kind === "seenNotRecorded"))
      run.notes.push(note("seenNotRecorded", messageOf(err)));
  }
}

async function watchPrint(
  run: Run,
  { transport, printer }: PrintAttempt,
  handle: PrintHandle,
  resuming = false,
): Promise<PrintOutcome> {
  let unread = resuming;
  const stopPolling = pollCancelFlag(run);
  const closing = new AbortController();
  const signal = AbortSignal.any([run.signal, closing.signal]);
  const statuses = transport.status(handle, signal, printer)[Symbol.asyncIterator]();
  try {
    while (true) {
      const next = await race(run, statuses.next()).catch((err: unknown) => {
        throw unread && !run.signal.aborted
          ? new ResumeFailedError(note("resumeError", messageOf(err)))
          : err;
      });
      if (next.done) {
        const lost = "connection lost before completion";
        throw unread
          ? new ResumeFailedError(note("resumeConnectionLost"))
          : new StageError("transport", lost);
      }
      unread = false;
      if (next.value.state !== "transferring") markPrinterSeen(run, handle.printerId);
      const outcome = await handleStatus(run, next.value);
      if (outcome) return outcome;
      await checkpoint(run);
    }
  } finally {
    stopPolling();
    closing.abort();
    const closeNote = await closeStream(run, statuses);
    if (closeNote) {
      run.notes.push(closeNote);
      run.ctx.log(`job ${run.opts.jobId} transport ${transport.id}: ${noteText(closeNote)}`);
    }
  }
}
