import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import {
  exhaustive,
  isTerminal,
  JOB_STREAM_CLOSE,
  type JobStatusEvent,
  parseStatusEvent,
} from "@conveyor/shared";
import { dbTypicalStageMs, openDb } from "@conveyor/shared/db";
import { enqueueJob, readSnapshot, requestCancel, tailEvents } from "@conveyor/shared/queue";
import type { FastifyInstance } from "fastify";
import { type ActiveJob, withEstimates } from "../estimates.js";
import { DEFAULT_HEARTBEAT, type Heartbeat, keepAlive } from "../heartbeat.js";
import { countSqliteLiveJobs, type LiveJobCounter } from "../live-jobs.js";
import { parseSubmission, registerArtifactRoute } from "./job-common.js";

export const countLiveJobs: LiveJobCounter = (reference, id) =>
  countSqliteLiveJobs(openDb())(reference, id);

type ActiveRow = {
  id: string;
  printer_id: string | null;
  generator_id: string;
  created_at: number;
};

function latestPrint(db: Database, jobId: string): JobStatusEvent["print"] {
  const row = db
    .query<{ event: string }, [string]>(
      "SELECT event FROM job_events WHERE job_id = ? ORDER BY seq DESC LIMIT 1",
    )
    .get(jobId);
  return row ? parseStatusEvent(row.event)?.print : undefined;
}

export interface TailOptions {
  fastMs: number;
  slowMs: number;
  idleMs: number;
  maxSockets: number;
  read: typeof tailEvents;
  now: () => number;
  schedule: (tick: () => void, ms: number) => () => void;
  heartbeat: Heartbeat;
}

const TAIL_PAGE = 100;
export const DEFAULT_TAIL: TailOptions = {
  fastMs: 250,
  slowMs: 1000,
  idleMs: 5000,
  maxSockets: 64,
  read: tailEvents,
  now: Date.now,
  schedule: (tick, ms) => {
    const timer = setTimeout(tick, ms);
    return () => clearTimeout(timer);
  },
  heartbeat: DEFAULT_HEARTBEAT,
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

  app.get("/jobs/active", async () => {
    const jobs = db
      .query<ActiveRow, []>(
        `SELECT id, printer_id, generator_id, created_at FROM jobs
          WHERE state NOT IN ('done', 'failed', 'canceled')
          ORDER BY updated_at DESC, rowid DESC`,
      )
      .all()
      .flatMap((row): ActiveJob[] => {
        try {
          const snapshot = readSnapshot(db, row.id)?.snapshot;
          const { printer_id, generator_id: generatorId, created_at: createdAt } = row;
          const event = snapshot && { ...snapshot, print: latestPrint(db, row.id) };
          return event ? [{ event, printerId: printer_id ?? "", generatorId, createdAt }] : [];
        } catch (err) {
          app.log.error({ err, jobId: row.id }, "unreadable job skipped in /jobs/active");
          return [];
        }
      });
    return withEstimates(jobs, (job) => dbTypicalStageMs(db, job), tail.now());
  });

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
    if (sockets >= tail.maxSockets)
      return socket.close(JOB_STREAM_CLOSE.busy, "too many job streams");
    sockets++;
    keepAlive(socket, tail.heartbeat);
    let cancel = () => {};
    let open = true;
    const release = () => {
      if (!open) return;
      open = false;
      sockets--;
      cancel();
    };
    const close = (code: number, reason: string) => {
      release();
      socket.close(code, reason);
    };
    const forward = (event: JobStatusEvent): boolean => {
      socket.send(JSON.stringify(event));
      if (isTerminal(event.state)) close(JOB_STREAM_CLOSE.finished, "job finished");
      return !open;
    };
    socket.on("close", release);
    let first: ReturnType<typeof readSnapshot>;
    try {
      first = readSnapshot(db, jobId);
    } catch (err) {
      req.log.error({ err, jobId }, "job snapshot unreadable");
      return close(JOB_STREAM_CLOSE.failed, "job stream failed");
    }
    if (!first) return close(JOB_STREAM_CLOSE.unknownJob, "unknown job");
    if (forward(first.snapshot)) return;
    let cursor = first.cursor;
    let lastEventAt = tail.now();
    const tick = () => {
      try {
        let page: ReturnType<typeof tailEvents>;
        do {
          page = tail.read(db, jobId, cursor, TAIL_PAGE);
          for (const { seq, event } of page) {
            cursor = seq;
            lastEventAt = tail.now();
            if (forward(event)) return;
          }
        } while (page.length === TAIL_PAGE);
      } catch (err) {
        req.log.error({ err, jobId }, "job event tail failed");
        return close(JOB_STREAM_CLOSE.failed, "job stream failed");
      }
      if (!open) return;
      const idle = tail.now() - lastEventAt > tail.idleMs;
      cancel = tail.schedule(tick, idle ? tail.slowMs : tail.fastMs);
    };
    cancel = tail.schedule(tick, tail.fastMs);
  });
}
