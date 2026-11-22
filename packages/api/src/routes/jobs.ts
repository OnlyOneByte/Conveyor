import { randomUUID } from "node:crypto";
import {
  ACTIVE_JOBS_KEY,
  CANCEL_TTL_SECONDS,
  isTerminal,
  type JobStatusEvent,
  jobCancelKey,
  jobControlChannel,
  jobSnapshotKey,
  parseStatusEvent,
  publishStatus,
} from "@conveyor/shared";
import { dbRecordJob, openDb } from "@conveyor/shared/db";
import type { FastifyInstance } from "fastify";
import { cancelJob } from "../cancel.js";
import type { LiveJobCounter } from "../live-jobs.js";
import { jobQueue, redis } from "../queue.js";
import { createStatusHub } from "../status-hub.js";
import { parseSubmission, registerArtifactRoute } from "./job-common.js";
import { isJobId, registerJobStream } from "./job-stream.js";

const LIVE_STATES = [
  "waiting",
  "active",
  "delayed",
  "prioritized",
  "paused",
  "waiting-children",
] as const;

export const countLiveJobs: LiveJobCounter = async (reference, id) =>
  (await jobQueue.getJobs([...LIVE_STATES])).filter((job) => job?.data?.[reference] === id).length;

export async function registerJobRoutes(app: FastifyInstance): Promise<void> {
  const statusHub = createStatusHub(
    () => redis.duplicate({ enableReadyCheck: false }),
    (err) => app.log.error({ err }, "job status subscriber error"),
  );
  app.post("/jobs", async (req, reply) => {
    const submission = parseSubmission(req.body);
    if (!submission.ok) return reply.code(submission.code).send({ error: submission.error });

    const jobId = randomUUID();
    await jobQueue.add("job", submission.request, { jobId });
    return reply.code(202).send({ jobId });
  });

  // Active jobs: the in-flight set → each job's live snapshot. Ordered newest-first
  // by event time. Registered BEFORE /jobs/:id so "active" is not swallowed as an id.
  // A stale member (worker died mid-job) resolves to a terminal or missing snapshot
  // and is filtered out here — the set is an index, the snapshot is the truth.
  app.get("/jobs/active", async () => {
    const ids = await redis.smembers(ACTIVE_JOBS_KEY);
    if (ids.length === 0) return [];
    const snapshots = await redis.mget(ids.map(jobSnapshotKey));
    const active: JobStatusEvent[] = [];
    const stale: string[] = [];
    for (let i = 0; i < ids.length; i++) {
      const evt = parseStatusEvent(snapshots[i]);
      if (!evt || isTerminal(evt.state)) stale.push(ids[i]);
      else active.push(evt);
    }
    // Opportunistically prune members whose snapshot is gone or already terminal so
    // the set self-heals; never fail the read if the prune errors.
    if (stale.length) await redis.srem(ACTIVE_JOBS_KEY, ...stale).catch(() => {});
    return active.sort((a, b) => b.at - a.at);
  });

  // Snapshot (reconnect-safe: PWA re-fetches this on WS reconnect).
  app.get<{ Params: { id: string } }>("/jobs/:id", async (req, reply) => {
    if (!isJobId(req.params.id)) return reply.code(404).send({ error: "unknown job" });
    const snapshot = await redis.get(jobSnapshotKey(req.params.id));
    if (!snapshot) return reply.code(404).send({ error: "unknown job" });
    return reply.send(JSON.parse(snapshot));
  });

  registerArtifactRoute(app);

  app.post<{ Params: { id: string } }>("/jobs/:id/cancel", async (req, reply) => {
    const jobId = req.params.id;
    if (!isJobId(jobId)) return reply.code(404).send({ ok: false, jobId, error: "unknown job" });
    const result = await cancelJob(req.params.id, {
      getJob: (id) => jobQueue.getJob(id),
      readSnapshot: async (id) => parseStatusEvent(await redis.get(jobSnapshotKey(id))),
      requestCancel: async (id) => {
        await redis
          .multi()
          .set(jobCancelKey(id), "1", "EX", CANCEL_TTL_SECONDS)
          .publish(jobControlChannel(id), "cancel")
          .exec();
      },
      settleCanceled: async (id, request) => {
        const written = await publishStatus(redis, {
          jobId: id,
          state: "canceled",
          at: Date.now(),
        });
        if (written) {
          dbRecordJob(openDb(), {
            id,
            generatorId: request.generator.id,
            params: request.generator.params,
            printerId: request.printerId,
            profileId: request.profileId,
            state: "canceled",
          });
        }
        return written;
      },
    });
    return reply.code(result.code).send(result.body);
  });

  registerJobStream(app, {
    hub: statusHub,
    snapshot: (id) => redis.get(jobSnapshotKey(id)),
    queued: async (id) => (await jobQueue.getJob(id)) !== undefined,
  });
}
