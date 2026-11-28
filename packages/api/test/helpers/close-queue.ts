import type { EventEmitter } from "node:events";
import { connection, jobQueue, redis } from "../../src/queue.js";
import { untilReady } from "../../src/queue-reach.js";

export const QUEUE_TEARDOWN_MS = 5_000;

export interface QueueParts {
  connection: Pick<EventEmitter, "once" | "off"> & {
    status: string;
    stream?: { writable: boolean };
    connect(): Promise<unknown>;
    disconnect(): void;
  };
  redis: { disconnect(): void };
  jobQueue: { obliterate(opts: { force: boolean }): Promise<unknown> };
}

function untilEnded(connection: QueueParts["connection"], withinMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const ended = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      connection.off("end", ended);
      reject(new Error(`queue connection didn't end within ${withinMs} ms`));
    }, withinMs);
    connection.once("end", ended);
    connection.disconnect();
  });
}

export async function closeQueue(
  url: string | undefined,
  parts: QueueParts = { connection, redis, jobQueue },
  withinMs = QUEUE_TEARDOWN_MS,
): Promise<void> {
  try {
    if (url) {
      const closing = parts.connection.stream?.writable === false;
      if (closing && parts.connection.status !== "end")
        await untilEnded(parts.connection, withinMs);
      if (parts.connection.status === "end") await parts.connection.connect();
      await untilReady(parts.connection, withinMs);
      await parts.jobQueue.obliterate({ force: true });
    }
  } finally {
    parts.connection.disconnect();
    parts.redis.disconnect();
  }
}
