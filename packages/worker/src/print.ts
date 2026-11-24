import { basename } from "node:path";
import {
  computeStageTimings,
  exhaustive,
  type GcodeArtifact,
  type JobTarget,
  type PrintHandle,
  PrintNotStartedError,
  type PrintStatus,
  StageError,
  type TransportPlugin,
} from "@conveyor/shared";
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

const DEFAULT_CANCEL_POLL_MS = 2000;
const DEFAULT_STREAM_CLOSE_MS = 5000;

export type PrintOutcome = "done" | "canceled";

export const RESUMED_MESSAGE = "resumed after worker restart";

export class ResumeFailedError extends Error {
  constructor(reason: string) {
    super(reason);
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
  await enterStage(run, "transport", "transferring");
  const transport = run.deps.registry.transports.get(target.transportId);
  if (!transport) throw new StageError("transport", `unknown transport ${target.transportId}`);
  const printer = await run.deps.resolvePrinter(target.printerId);
  const attempt: PrintAttempt = { transport, printer, ref: basename(gcode.path) };
  run.print = attempt;
  attempt.handle = await transport.submit(gcode, printer, run.ctx).catch((err) => {
    if (err instanceof PrintNotStartedError) attempt.notStarted = true;
    throw err;
  });
  await queue?.markSubmitted(attempt.handle);
  await checkpoint(run);
  run.state = "printing";
  return watchPrint(run, transport, attempt.handle);
}

export async function resumePrint(run: Run, handle: PrintHandle): Promise<PrintOutcome> {
  const transport = run.deps.registry.transports.get(handle.transportId);
  if (!transport) throw new ResumeFailedError(`unknown transport ${handle.transportId}`);
  const printer = await run.deps.resolvePrinter(handle.printerId).catch((err: unknown) => {
    throw new ResumeFailedError(messageOf(err));
  });
  run.print = { transport, printer, ref: handle.ref, handle };
  await run.deps.publish(run.opts.jobId, "printing", {
    stage: "transport",
    message: RESUMED_MESSAGE,
    timings: computeStageTimings(run.enters),
  });
  return watchPrint(run, transport, handle, true);
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
): Promise<string | undefined> {
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
  return failure === undefined ? undefined : `status stream did not close cleanly: ${failure}`;
}

export const SEEN_WRITE_FAILED = "printer last-seen time not recorded";

function markPrinterSeen(run: Run, printerId: string): void {
  try {
    run.deps.printerSeen(printerId);
  } catch (err) {
    run.ctx.log(`job ${run.opts.jobId}: ${SEEN_WRITE_FAILED}: ${messageOf(err)}`);
    if (!run.notes.some((note) => note.startsWith(SEEN_WRITE_FAILED)))
      run.notes.push(`${SEEN_WRITE_FAILED}: ${messageOf(err)}`);
  }
}

async function watchPrint(
  run: Run,
  transport: TransportPlugin,
  handle: PrintHandle,
  resuming = false,
): Promise<PrintOutcome> {
  let unread = resuming;
  const stopPolling = pollCancelFlag(run);
  const closing = new AbortController();
  const signal = AbortSignal.any([run.signal, closing.signal]);
  const statuses = transport.status(handle, signal)[Symbol.asyncIterator]();
  try {
    while (true) {
      const next = await race(run, statuses.next()).catch((err: unknown) => {
        throw unread && !run.signal.aborted ? new ResumeFailedError(messageOf(err)) : err;
      });
      if (next.done) {
        const lost = "connection lost before completion";
        throw unread ? new ResumeFailedError(lost) : new StageError("transport", lost);
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
      run.ctx.log(`job ${run.opts.jobId} transport ${transport.id}: ${closeNote}`);
    }
  }
}

export function fallbackHandle(attempt: PrintAttempt): PrintHandle {
  const { transport, printer, ref } = attempt;
  return (
    transport.handleFor?.(printer, ref) ?? {
      transportId: transport.id,
      printerId: printer.id,
      ref,
      address: printer.address,
    }
  );
}
