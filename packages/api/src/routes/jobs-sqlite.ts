import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { exhaustive, isTerminal, type JobStatusEvent } from "@conveyor/shared";
import { openDb } from "@conveyor/shared/db";
import { enqueueJob, readSnapshot, requestCancel, tailEvents } from "@conveyor/shared/queue";
import type { FastifyInstance } from "fastify";
import { parseSubmission, registerArtifactRoute } from "./job-common.js";

export const TAIL_FAST_MS = 250;
export const TAIL_SLOW_MS = 1000;
export const TAIL_IDLE_MS = 5000;

export async function registerJobRoutes(
  app: FastifyInstance,
  db: Database = openDb(),
): Promise<void> {
  app.post("/jobs", async (req, reply) => {
    const submission = parseSubmission(req.body);
    if (!submission.ok) return reply.code(submission.code).send({ error: submission.error });
    const jobId = randomUUID();
    enqueueJob(db, { id: jobId, request: submission.request });
    return reply.code(202).send({ jobId });
  });

  app.get("/jobs/active", async () =>
    db
      .query<{ id: string }, []>(
        `SELECT id FROM jobs WHERE state NOT IN ('done', 'failed', 'canceled')
          ORDER BY updated_at DESC, rowid DESC`,
      )
      .all()
      .flatMap(({ id }) => readSnapshot(db, id)?.snapshot ?? []),
  );

  app.get<{ Params: { id: string } }>("/jobs/:id", async (req, reply) => {
    const read = readSnapshot(db, req.params.id);
    if (!read) return reply.code(404).send({ error: "unknown job" });
    return reply.send(read.snapshot);
  });

  registerArtifactRoute(app);

  app.post<{ Params: { id: string } }>("/jobs/:id/cancel", async (req, reply) => {
    const jobId = req.params.id;
    const outcome = requestCancel(db, jobId);
    switch (outcome.kind) {
      case "settled":
        return reply.code(200).send({ ok: true, jobId, state: outcome.state });
      case "unknown":
        return reply.code(404).send({ ok: false, jobId, error: "unknown job" });
      case "canceled":
        return reply.code(200).send({ ok: true, jobId, state: "canceled" });
      case "canceling":
        return reply.code(202).send({ ok: true, jobId, state: "canceling" });
      default:
        return exhaustive(outcome);
    }
  });

  app.get<{ Params: { id: string } }>("/jobs/:id/ws", { websocket: true }, (socket, req) => {
    const jobId = req.params.id;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let open = true;
    const close = () => {
      open = false;
      clearTimeout(timer);
      socket.close();
    };
    const forward = (event: JobStatusEvent): boolean => {
      socket.send(JSON.stringify(event));
      if (isTerminal(event.state)) close();
      return !open;
    };
    socket.on("close", () => {
      open = false;
      clearTimeout(timer);
    });
    const first = readSnapshot(db, jobId);
    if (!first) return close();
    if (forward(first.snapshot)) return;
    let cursor = first.cursor;
    let lastEventAt = Date.now();
    const tick = () => {
      try {
        for (const { seq, event } of tailEvents(db, jobId, cursor)) {
          cursor = seq;
          lastEventAt = Date.now();
          if (forward(event)) return;
        }
      } catch (err) {
        req.log.error({ err, jobId }, "job event tail failed");
        return close();
      }
      if (!open) return;
      const idle = Date.now() - lastEventAt > TAIL_IDLE_MS;
      timer = setTimeout(tick, idle ? TAIL_SLOW_MS : TAIL_FAST_MS);
    };
    timer = setTimeout(tick, TAIL_FAST_MS);
  });
}
