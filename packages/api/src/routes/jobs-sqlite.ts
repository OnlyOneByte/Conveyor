import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { exhaustive, isTerminal, type JobStatusEvent } from "@conveyor/shared";
import { openDb } from "@conveyor/shared/db";
import { enqueueJob, readSnapshot, requestCancel, tailEvents } from "@conveyor/shared/queue";
import type { FastifyInstance } from "fastify";
import { parseSubmission, registerArtifactRoute } from "./job-common.js";

export interface TailOptions {
  fastMs: number;
  slowMs: number;
  idleMs: number;
  lifetimeMs: number;
  maxSockets: number;
  read: typeof tailEvents;
}

export const TAIL_PAGE = 100;
export const DEFAULT_TAIL: TailOptions = {
  fastMs: 250,
  slowMs: 1000,
  idleMs: 5000,
  lifetimeMs: 30 * 60 * 1000,
  maxSockets: 64,
  read: tailEvents,
};

export async function registerJobRoutes(
  app: FastifyInstance,
  db: Database = openDb(),
  tail: TailOptions = DEFAULT_TAIL,
): Promise<void> {
  let sockets = 0;

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
      .flatMap(({ id }) => {
        try {
          return readSnapshot(db, id)?.snapshot ?? [];
        } catch (err) {
          app.log.error({ err, jobId: id }, "unreadable job skipped in /jobs/active");
          return [];
        }
      }),
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
    if (sockets >= tail.maxSockets) return socket.close(1013, "too many job streams");
    sockets++;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let open = true;
    const release = () => {
      if (!open) return;
      open = false;
      sockets--;
      clearTimeout(timer);
      clearTimeout(lifetime);
    };
    const close = () => {
      release();
      socket.close();
    };
    const lifetime = setTimeout(close, tail.lifetimeMs);
    const forward = (event: JobStatusEvent): boolean => {
      socket.send(JSON.stringify(event));
      if (isTerminal(event.state)) close();
      return !open;
    };
    socket.on("close", release);
    let first: ReturnType<typeof readSnapshot>;
    try {
      first = readSnapshot(db, jobId);
    } catch (err) {
      req.log.error({ err, jobId }, "job snapshot unreadable");
      return close();
    }
    if (!first) return close();
    if (forward(first.snapshot)) return;
    let cursor = first.cursor;
    let lastEventAt = Date.now();
    const tick = () => {
      try {
        let page: ReturnType<typeof tailEvents>;
        do {
          page = tail.read(db, jobId, cursor, TAIL_PAGE);
          for (const { seq, event } of page) {
            cursor = seq;
            lastEventAt = Date.now();
            if (forward(event)) return;
          }
        } while (page.length === TAIL_PAGE);
      } catch (err) {
        req.log.error({ err, jobId }, "job event tail failed");
        return close();
      }
      if (!open) return;
      const idle = Date.now() - lastEventAt > tail.idleMs;
      timer = setTimeout(tick, idle ? tail.slowMs : tail.fastMs);
    };
    timer = setTimeout(tick, tail.fastMs);
  });
}
