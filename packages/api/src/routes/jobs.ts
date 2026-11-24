import { randomUUID } from "node:crypto";
import {
  ACTIVE_JOBS_KEY,
  CANCEL_TTL_SECONDS,
  isTerminal,
  type JobRequest,
  type JobStatusEvent,
  type JobView,
  jobCancelKey,
  jobControlChannel,
  jobRequestSchema,
  jobSnapshotKey,
  jobView,
  parseStatusEvent,
  publishStatus,
} from "@conveyor/shared";
import { dbMarkRetried, dbRecordJob, dbTypicalStageMs, openDb } from "@conveyor/shared/db";
import type { Queue } from "bullmq";
import type { FastifyInstance } from "fastify";
import { cancelJob } from "../cancel.js";
import { type ActiveJob, withEstimates } from "../estimates.js";
import type { LiveJobCounter } from "../live-jobs.js";
import { jobQueue, redis } from "../queue.js";
import { createStatusHub } from "../status-hub.js";
import { parseSubmission, registerArtifactRoute, registerNeedsYouRoutes } from "./job-common.js";
import { isJobId, registerJobStream } from "./job-stream.js";

const LIVE_STATES = ["waiting", "active", "delayed", "prioritized", "waiting-children"] as const;

export const countLiveJobs: LiveJobCounter = async (reference, id) =>
  (await jobQueue.getJobs([...LIVE_STATES])).filter((job) => job?.data?.[reference] === id).length;

export type JobLookup = Pick<Queue<JobRequest>, "getJob">;

async function activeJob(jobs: JobLookup, event: JobStatusEvent): Promise<ActiveJob> {
  const job = await jobs.getJob(event.jobId);
  const request = jobRequestSchema.safeParse(job?.data);
  return {
    event,
    printerId: request.success ? request.data.printerId : "",
    generatorId: request.success ? request.data.generator.id : "",
    createdAt: job?.timestamp ?? event.at,
  };
}

export async function registerJobRoutes(
  app: FastifyInstance,
  jobs: JobLookup = jobQueue,
): Promise<void> {
  const statusHub = createStatusHub(
    () => redis.duplicate({ enableReadyCheck: false }),
    (err) => app.log.error({ err }, "job status subscriber error"),
  );
  app.post("/jobs", async (req, reply) => {
    const submission = parseSubmission(req.body);
    if (!submission.ok) return reply.code(submission.code).send({ error: submission.error });

    const jobId = randomUUID();
    await jobQueue.add("job", submission.request, { jobId });
    if (submission.retryOf) dbMarkRetried(openDb(), submission.retryOf, jobId);
    return reply.code(202).send({ jobId });
  });

  const withFields = async (snapshot: JobStatusEvent): Promise<JobView> => {
    let fields: unknown;
    try {
      const job = await jobQueue.getJob(snapshot.jobId);
      fields = job && { ...job.data, createdAt: job.timestamp };
    } catch (err) {
      app.log.error({ err, jobId: snapshot.jobId }, "job request fields unreadable");
      return snapshot;
    }
    const { view, complete } = jobView(snapshot, fields);
    if (!complete) app.log.error({ jobId: snapshot.jobId }, "job request fields incomplete");
    return view;
  };

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
    if (stale.length) await redis.srem(ACTIVE_JOBS_KEY, ...stale).catch(() => {});
    active.sort((a, b) => b.at - a.at);
    let listed: JobStatusEvent[] = active;
    try {
      const live = await Promise.all(active.map((event) => activeJob(jobs, event)));
      const typical = (job: ActiveJob) => dbTypicalStageMs(openDb(), job);
      listed = withEstimates(live, { typical, isHeld: () => false }, Date.now());
    } catch (err) {
      app.log.warn({ err }, "job estimates left out of /jobs/active");
    }
    return Promise.all(listed.map(withFields));
  });

  app.get<{ Params: { id: string } }>("/jobs/:id", async (req, reply) => {
    if (!isJobId(req.params.id)) return reply.code(404).send({ error: "unknown job" });
    const snapshot = parseStatusEvent(await redis.get(jobSnapshotKey(req.params.id)));
    if (!snapshot) return reply.code(404).send({ error: "unknown job" });
    return reply.send(await withFields(snapshot));
  });

  registerArtifactRoute(app);
  registerNeedsYouRoutes(app);

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
