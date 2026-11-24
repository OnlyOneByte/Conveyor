import type { EventEmitter } from "node:events";

export class QueueUnavailableError extends Error {
  override name = "QueueUnavailableError";
}

const UNREACHABLE_MESSAGES = new Set([
  "Command timed out",
  "Connection is closed.",
  "Stream isn't writeable and enableOfflineQueue options is false",
]);

const UNREACHABLE_NAMES = new Set(["QueueUnavailableError", "MaxRetriesPerRequestError"]);

export function isQueueUnavailable(err: unknown): boolean {
  return (
    err instanceof Error &&
    (UNREACHABLE_NAMES.has(err.name) || UNREACHABLE_MESSAGES.has(err.message))
  );
}

export function untilReady(
  client: Pick<EventEmitter, "once" | "off"> & { status: string },
  withinMs: number,
): Promise<void> {
  if (client.status === "ready") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const settle = (err?: Error) => {
      clearTimeout(timer);
      client.off("ready", ready);
      client.off("end", ended);
      if (err) reject(err);
      else resolve();
    };
    const ready = () => settle();
    const ended = () => settle(new QueueUnavailableError("queue connection ended"));
    const timer = setTimeout(
      () => settle(new QueueUnavailableError(`queue not back within ${withinMs} ms`)),
      withinMs,
    );
    timer.unref?.();
    client.once("ready", ready);
    client.once("end", ended);
  });
}

export async function withinDeadline<T>(call: Promise<T>, deadlineMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new QueueUnavailableError(`queue gave no answer within ${deadlineMs} ms`)),
      deadlineMs,
    );
  });
  try {
    return await Promise.race([call, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
