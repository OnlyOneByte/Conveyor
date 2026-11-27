import { type Note, note, noteText, type PrintHandle } from "@conveyor/shared";
import { JobCanceledError, LeaseLostError, messageOf, type PrintAttempt, type Run } from "./run.js";

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

export const canceled = (run: Run, err: unknown) =>
  !(err instanceof LeaseLostError || run.signal.reason instanceof LeaseLostError) &&
  (err instanceof JobCanceledError || run.signal.aborted);

async function sendStop(run: Run, signal?: AbortSignal): Promise<Note | undefined> {
  const attempt = run.print;
  if (!attempt || attempt.notStarted) return undefined;
  const { transport } = attempt;
  if (!transport.cancel) return note("cannotStop", `${transport.id} cannot stop a print`);
  try {
    await transport.cancel(attempt.handle ?? fallbackHandle(attempt), attempt.printer, signal);
    run.ctx.log(`transport ${transport.id} cancel sent`);
    return undefined;
  } catch (e) {
    const reason = note("stopUnconfirmed", messageOf(e));
    run.ctx.log(noteText(reason));
    return reason;
  }
}

export function stopPrinter(run: Run, signal?: AbortSignal): Promise<Note | undefined> {
  run.stop ??= sendStop(run, signal);
  return run.stop;
}

export const STOP_BOUND_MS = 20_000;

export async function stopWithin(run: Run, ms = run.opts.stopBoundMs ?? STOP_BOUND_MS) {
  const bound = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"late">((resolve) => {
    timer = setTimeout(() => resolve("late"), ms);
  });
  const answered = await Promise.race([stopPrinter(run, bound.signal), late]);
  clearTimeout(timer);
  if (answered !== "late") return;
  bound.abort(new Error(`no answer within ${ms} ms`));
  const unanswered = note("stopUnconfirmed", `no answer within ${ms} ms; check the printer`);
  run.ctx.log(noteText(unanswered));
  run.stop = Promise.resolve(unanswered);
}
