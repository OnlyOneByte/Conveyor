import { connection, jobQueue, redis } from "../../src/queue.js";
import { untilReady } from "../../src/queue-reach.js";

export const QUEUE_TEARDOWN_MS = 5_000;

export async function closeQueue(env: Record<string, string | undefined> = process.env) {
  try {
    if (env.REDIS_URL) {
      if (connection.status === "end") await connection.connect();
      await untilReady(connection, QUEUE_TEARDOWN_MS);
      await jobQueue.obliterate({ force: true });
    }
  } finally {
    connection.disconnect();
    redis.disconnect();
  }
}
