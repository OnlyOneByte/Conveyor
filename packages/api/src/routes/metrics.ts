import type { Database } from "bun:sqlite";
import {
  dbCountJobs,
  dbFailuresByStage,
  dbReadWorkerHeartbeats,
  dbRecentStageDurations,
  openDb,
} from "@conveyor/shared/db";
import type { FastifyInstance } from "fastify";
import { workerFresh } from "../health.js";
import { renderMetrics } from "../metrics.js";

export type LiveJobCounts = () => Promise<Record<string, number>>;

export const METRICS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";

export function registerMetricsRoutes(
  app: FastifyInstance,
  liveCounts: LiveJobCounts,
  db: () => Database = () => openDb(),
  now: () => number = Date.now,
): void {
  app.get("/metrics", async (req, reply) => {
    let live: Record<string, number>;
    try {
      live = await liveCounts();
    } catch (err) {
      req.log.warn({ err }, "metrics: live job counts unavailable");
      return reply.code(503).send({ error: "the job queue is unreachable" });
    }
    const conn = db();
    const at = now();
    const text = renderMetrics({
      finished: dbCountJobs(conn),
      failuresByStage: dbFailuresByStage(conn),
      live,
      workersUp: dbReadWorkerHeartbeats(conn, at).filter((beat) => workerFresh(beat, at)).length,
      durations: dbRecentStageDurations(conn),
    });
    return reply
      .header("content-type", METRICS_CONTENT_TYPE)
      .header("cache-control", "no-store")
      .send(text);
  });
}
