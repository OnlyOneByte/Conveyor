import { rm } from "node:fs/promises";
import { computeStageTimings, StageError } from "@conveyor/shared";
import { fallbackHandle } from "./print.js";
import { JobCanceledError, messageOf, type Run, type TerminalState } from "./run.js";

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

export async function settleDone(run: Run): Promise<TerminalState> {
  const timings = computeStageTimings(run.enters, Date.now());
  await run.deps.publish(run.opts.jobId, "done", {
    stage: run.stage,
    message: noted(run),
    timings,
  });
  run.deps.record(run.opts.jobId, run.opts.req, {
    state: "done",
    modelPath: run.modelPath,
    gcodePath: run.gcodePath,
    timings,
  });
  return "done";
}

export async function settleCanceled(run: Run, message?: string): Promise<TerminalState> {
  await cleanup(run);
  const timings = computeStageTimings(run.enters, Date.now());
  await run.deps.publish(run.opts.jobId, "canceled", {
    stage: run.stage,
    message: noted(run, message),
    timings,
  });
  run.deps.record(run.opts.jobId, run.opts.req, {
    state: "canceled",
    stage: run.stage,
    reason: noted(run),
    timings,
  });
  return "canceled";
}

async function settleFailed(run: Run, se: StageError): Promise<never> {
  await cleanup(run);
  const timings = computeStageTimings(run.enters, Date.now());
  const reason = noted(run, se.reason) ?? se.reason;
  await run.deps.publish(run.opts.jobId, "failed", {
    stage: se.stage,
    error: { stage: se.stage, reason },
    timings,
  });
  run.deps.record(run.opts.jobId, run.opts.req, {
    state: "failed",
    stage: se.stage,
    reason,
    timings,
  });
  throw se;
}

export async function settleError(run: Run, err: unknown): Promise<TerminalState> {
  if (err instanceof JobCanceledError || run.signal.aborted) {
    const stopError = await stopPrinter(run);
    if (stopError) return settleFailed(run, new StageError("transport", stopError));
    return settleCanceled(run);
  }
  const se =
    err instanceof StageError ? err : new StageError(run.stage, messageOf(err), { cause: err });
  return settleFailed(run, se);
}
