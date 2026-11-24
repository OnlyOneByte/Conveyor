export class QueueUnavailableError extends Error {
  override name = "QueueUnavailableError";
}

const UNREACHABLE_MESSAGES = new Set([
  "Command timed out",
  "Connection is closed.",
  "Stream isn't writeable and enableOfflineQueue options is false",
]);

export function isQueueUnavailable(err: unknown): boolean {
  return (
    err instanceof QueueUnavailableError ||
    (err instanceof Error && UNREACHABLE_MESSAGES.has(err.message))
  );
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
