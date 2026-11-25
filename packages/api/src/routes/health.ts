import type { Database } from "bun:sqlite";
import { dbReadWorkerHeartbeat, openDb } from "@conveyor/shared/db";
import type { FastifyInstance } from "fastify";
import { healthReport } from "../health.js";
import { withinDeadline } from "../queue-reach.js";

interface QueueRedis {
  redis: { ping(): Promise<unknown> };
  QUEUE_DEADLINE_MS: number;
}

export const redisPing = (
  queue: string,
  load: () => Promise<QueueRedis> = () => import("../queue.js"),
): (() => Promise<unknown>) | undefined =>
  queue === "redis"
    ? async () => {
        const { redis, QUEUE_DEADLINE_MS } = await load();
        return withinDeadline(redis.ping(), QUEUE_DEADLINE_MS);
      }
    : undefined;

export function registerHealthRoutes(
  app: FastifyInstance,
  redis?: () => Promise<unknown>,
  db: () => Database = () => openDb(),
): void {
  app.get("/health/deep", async (req, reply) => {
    const report = await healthReport({
      db: () => db().query("SELECT 1").get(),
      redis,
      heartbeat: () => dbReadWorkerHeartbeat(db()),
      now: Date.now(),
      onError: (check, err) => req.log.warn({ err }, `health: ${check} check failed`),
    });
    return reply.code(report.status === "down" ? 503 : 200).send(report);
  });
}
