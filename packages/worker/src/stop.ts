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

async function sendStop(run: Run): Promise<Note | undefined> {
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

export function stopPrinter(run: Run): Promise<Note | undefined> {
  run.stop ??= sendStop(run);
  return run.stop;
}
