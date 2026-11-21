import { basename } from "node:path";
import {
  computeStageTimings,
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
  messageOf,
  type PrintAttempt,
  type Run,
  race,
} from "./run.js";

const DEFAULT_CANCEL_POLL_MS = 2000;
const DEFAULT_STREAM_CLOSE_MS = 5000;

export class StreamCloseError extends StageError {
  constructor(reason: string) {
    super("transport", `status stream did not close cleanly: ${reason}`);
    this.name = "StreamCloseError";
  }
}

export type PrintOutcome = "done" | "canceled";

export async function printStage(
  run: Run,
  target: JobTarget,
  gcode: GcodeArtifact,
): Promise<PrintOutcome> {
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
  await checkpoint(run);
  run.state = "printing";
  return watchPrint(run, transport, attempt.handle);
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
  if (status.state === "done" || status.state === "canceled") return status.state;
  if (status.state === "failed") {
    throw new StageError("transport", status.message ?? status.state);
  }
  if (status.state === "printing") {
    await run.deps.publish(run.opts.jobId, "printing", {
      stage: run.stage,
      progress: status.progress,
      message: status.message,
      timings: computeStageTimings(run.enters),
    });
  }
  return undefined;
}

async function closeStream(run: Run, statuses: AsyncIterator<PrintStatus>): Promise<void> {
  if (!statuses.return) return;
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
  if (failure !== undefined) throw new StreamCloseError(failure);
}

async function watchPrint(
  run: Run,
  transport: TransportPlugin,
  handle: PrintHandle,
): Promise<PrintOutcome> {
  const stopPolling = pollCancelFlag(run);
  const closing = new AbortController();
  const signal = AbortSignal.any([run.signal, closing.signal]);
  const statuses = transport.status(handle, signal)[Symbol.asyncIterator]();
  try {
    while (true) {
      const next = await race(run, statuses.next());
      if (next.done) throw new StageError("transport", "connection lost before completion");
      const outcome = await handleStatus(run, next.value);
      if (outcome) return outcome;
      await checkpoint(run);
    }
  } finally {
    stopPolling();
    closing.abort();
    await closeStream(run, statuses);
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
