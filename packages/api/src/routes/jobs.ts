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
import { dbRecordJob, dbTypicalStageMs, openDb } from "@conveyor/shared/db";
import type { Queue } from "bullmq";
import type { FastifyInstance } from "fastify";
import { cancelJob } from "../cancel.js";
import { type ActiveJob, withEstimates } from "../estimates.js";
import type { LiveJobCounter } from "../live-jobs.js";
import { connection, createSubscriber, jobQueue, QUEUE_DEADLINE_MS, redis } from "../queue.js";
import { withinDeadline } from "../queue-reach.js";
import { createStatusHub } from "../status-hub.js";
import { parseSubmission, registerArtifactRoute, registerNeedsYouRoutes } from "./job-common.js";
import { isJobId, registerJobStream } from "./job-stream.js";
import { submitJob } from "./submit.js";

const LIVE_STATES = ["waiting", "active", "delayed", "prioritized", "waiting-children"] as const;

const reach = <T>(call: Promise<T>): Promise<T> => withinDeadline(call, QUEUE_DEADLINE_MS);

export const countLiveJobs: LiveJobCounter = async (reference, id) =>
  (await reach(jobQueue.getJobs([...LIVE_STATES]))).filter((job) => job?.data?.[reference] === id)
    .length;

export type JobLookup = Pick<Queue<JobRequest>, "getJob">;

const reachableJobs: JobLookup = { getJob: (id) => reach(jobQueue.getJob(id)) };

async function dropAbandoned(app: FastifyInstance, jobId: string): Promise<void> {
  if (connection.status !== "ready") return;
  const [removed, flagged] = await Promise.allSettled([
    jobQueue.remove(jobId),
    connection.set(jobCancelKey(jobId), "1", "EX", CANCEL_TTL_SECONDS),
  ]);
  for (const [step, outcome] of [
    ["remove", removed],
    ["cancel flag", flagged],
  ] as const) {
    if (outcome.status === "rejected")
      app.log.error({ err: outcome.reason, jobId }, `abandoned job ${step} failed`);
  }
}

async function enqueue(app: FastifyInstance, jobId: string, request: JobRequest): Promise<void> {
  try {
    await reach(jobQueue.add("job", request, { jobId }));
  } catch (err) {
    app.log.warn(
      { jobId },
      "enqueue failed; removing the job and flagging it canceled if it lands",
    );
    void jobQueue.waitUntilReady().then(
      () => dropAbandoned(app, jobId),
      (initErr: unknown) =>
        app.log.error({ err: initErr, jobId }, "queue never came up to drop the job"),
    );
    throw err;
  }
}

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
  jobs: JobLookup = reachableJobs,
): Promise<void> {
  const logHubError = (err: unknown) => app.log.error({ err }, "job status subscriber error");
  const statusHub = createStatusHub(createSubscriber, logHubError);
  app.post("/jobs", async (req, reply) => {
    const submission = parseSubmission(req.body);
    if (!submission.ok) return reply.code(submission.code).send({ error: submission.error });

    const result = await submitJob(openDb(), submission, (jobId, request) =>
      enqueue(app, jobId, request),
    );
    return reply.code(result.code).send(result.body);
  });

  const withFields = async (snapshot: JobStatusEvent): Promise<JobView> => {
    let fields: unknown;
    try {
      const job = await reach(jobQueue.getJob(snapshot.jobId));
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
    const canceling = cancelJob(req.params.id, {
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
    const result = await reach(canceling);
    return reply.code(result.code).send(result.body);
  });

  registerJobStream(app, {
    hub: statusHub,
    snapshot: (id) => redis.get(jobSnapshotKey(id)),
    queued: async (id) => (await reach(jobQueue.getJob(id))) !== undefined,
  });
}
