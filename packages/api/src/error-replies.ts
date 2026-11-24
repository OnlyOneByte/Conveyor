import type { FastifyInstance } from "fastify";
import { isQueueUnavailable } from "./queue-reach.js";

function statusOf(error: unknown): number {
  if (typeof error !== "object" || error === null || !("statusCode" in error)) return 500;
  return typeof error.statusCode === "number" ? error.statusCode : 500;
}

export function registerErrorReplies(app: FastifyInstance): void {
  app.setErrorHandler((error, req, reply) => {
    if (isQueueUnavailable(error)) {
      req.log.warn({ err: error }, "queue unavailable");
      return reply.code(503).send({ error: "queue unavailable" });
    }
    if (statusOf(error) < 500) return reply.send(error);
    req.log.error({ err: error }, "request failed");
    return reply.code(500).send({ error: "internal error" });
  });
}
