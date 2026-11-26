import type { EventEmitter } from "node:events";
import { connection, jobQueue, redis } from "../../src/queue.js";
import { untilReady } from "../../src/queue-reach.js";

export const QUEUE_TEARDOWN_MS = 5_000;

export interface QueueParts {
  connection: Pick<EventEmitter, "once" | "off"> & {
    status: string;
    connect(): Promise<unknown>;
    disconnect(): void;
  };
  redis: { disconnect(): void };
  jobQueue: { obliterate(opts: { force: boolean }): Promise<unknown> };
}

export async function closeQueue(
  url: string | undefined,
  parts: QueueParts = { connection, redis, jobQueue },
  withinMs = QUEUE_TEARDOWN_MS,
): Promise<void> {
  try {
    if (url) {
      if (parts.connection.status === "end") await parts.connection.connect();
      await untilReady(parts.connection, withinMs);
      await parts.jobQueue.obliterate({ force: true });
    }
  } finally {
    parts.connection.disconnect();
    parts.redis.disconnect();
  }
}
