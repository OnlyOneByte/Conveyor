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
import { dbRecordJob, dbTypicalStageMs, openDb, queuedCancelRecord } from "@conveyor/shared/db";
import type { Queue } from "bullmq";
import type { FastifyInstance } from "fastify";
import { cancelJob } from "../cancel.js";
import { type ActiveJob, withEstimates } from "../estimates.js";
import type { LiveJobCounter } from "../live-jobs.js";
import { connection, createSubscriber, jobQueue, QUEUE_DEADLINE_MS, redis } from "../queue.js";
import { untilReady, withinDeadline } from "../queue-reach.js";
import { createStatusHub } from "../status-hub.js";
import { parseSubmission, registerArtifactRoute, registerNeedsYouRoutes } from "./job-common.js";
import { isJobId, registerJobStream } from "./job-stream.js";
import type { LiveJobCounts } from "./metrics.js";
import { logCancel, logSubmitted, submitJob } from "./submit.js";

export const DROP_WITHIN_MS = 5 * 60_000;
const LIVE_STATES = ["waiting", "active", "delayed", "prioritized", "waiting-children"] as const;

const reach = <T>(call: Promise<T>): Promise<T> => withinDeadline(call, QUEUE_DEADLINE_MS);

export const countLiveJobs: LiveJobCounter = async (reference, id) =>
  (await reach(jobQueue.getJobs([...LIVE_STATES]))).filter((job) => job?.data?.[reference] === id)
    .length;

export const liveJobCounts: LiveJobCounts = () => reach(jobQueue.getJobCounts(...LIVE_STATES));

export type JobLookup = Pick<Queue<JobRequest>, "getJob">;

const reachableJobs: JobLookup = { getJob: (id) => reach(jobQueue.getJob(id)) };

async function dropAbandoned(app: FastifyInstance, jobId: string): Promise<void> {
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
    void untilReady(connection, DROP_WITHIN_MS).then(
      () => dropAbandoned(app, jobId),
      (initErr: unknown) =>
        app.log.error({ err: initErr, jobId }, "queue never came up to drop the job"),
    );
    throw err;
  }
}

type QueuedJob = Awaited<ReturnType<JobLookup["getJob"]>>;

function activeJob(job: QueuedJob, event: JobStatusEvent): ActiveJob {
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
    logSubmitted(req.log, submission, result);
    return reply.code(result.code).send(result.body);
  });

  const readJob = async (jobId: string): Promise<QueuedJob | null> => {
    try {
      return await jobs.getJob(jobId);
    } catch (err) {
      app.log.error({ err, jobId }, "job request fields unreadable");
      return null;
    }
  };

  const withFields = (snapshot: JobStatusEvent, job: QueuedJob | null): JobView => {
    if (job === null) return snapshot;
    const { view, complete } = jobView(snapshot, job && { ...job.data, createdAt: job.timestamp });
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
    if (stale.length) {
      await redis.srem(ACTIVE_JOBS_KEY, ...stale).catch((err: unknown) => {
        app.log.warn({ err, jobIds: stale }, "settled jobs not pruned from the active set");
      });
    }
    active.sort((a, b) => b.at - a.at);
    const queued = new Map(
      await Promise.all(
        active.map(async (event) => [event.jobId, await readJob(event.jobId)] as const),
      ),
    );
    let listed: JobStatusEvent[] = active;
    try {
      const live = active.map((event) => activeJob(queued.get(event.jobId) ?? undefined, event));
      const typical = (job: ActiveJob) => dbTypicalStageMs(openDb(), job);
      listed = withEstimates(live, { typical, isHeld: () => false }, Date.now());
    } catch (err) {
      app.log.warn({ err }, "job estimates left out of /jobs/active");
    }
    return listed.map((event) => withFields(event, queued.get(event.jobId)));
  });

  app.get<{ Params: { id: string } }>("/jobs/:id", async (req, reply) => {
    if (!isJobId(req.params.id)) return reply.code(404).send({ error: "unknown job" });
    const snapshot = parseStatusEvent(await redis.get(jobSnapshotKey(req.params.id)));
    if (!snapshot) return reply.code(404).send({ error: "unknown job" });
    return reply.send(withFields(snapshot, await readJob(snapshot.jobId)));
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
          dbRecordJob(openDb(), queuedCancelRecord(id, request));
        }
        return written;
      },
    });
    const result = await reach(canceling);
    logCancel(req.log, jobId, result.code);
    return reply.code(result.code).send(result.body);
  });

  registerJobStream(app, {
    hub: statusHub,
    snapshot: (id) => redis.get(jobSnapshotKey(id)),
    queued: async (id) => (await reach(jobQueue.getJob(id))) !== undefined,
  });
}
