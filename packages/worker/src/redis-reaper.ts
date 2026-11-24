import type { Database } from "bun:sqlite";
import {
  ACTIVE_JOBS_KEY,
  isTerminal,
  type JobStatusEvent,
  jobRequestSchema,
  jobSnapshotKey,
  parseStatusEvent,
  publishStatus,
  type Stage,
} from "@conveyor/shared";
import {
  dbDismissJob,
  dbGetJob,
  dbListUnrecordedRetryClaims,
  dbRecordJob,
  dbReleaseRetry,
  dbRetryOf,
  openDb,
} from "@conveyor/shared/db";
import type { Queue } from "bullmq";
import type { Redis } from "ioredis";

export const ORPHAN_REASON =
  "the worker stopped before recording how this job ended; check the printer before you retry";
export const REAPER_INTERVAL_MS = 60_000;

const LIVE_STATES = new Set(["waiting", "active", "delayed", "prioritized", "waiting-children"]);

export interface QueuedJob {
  state: string;
  data: unknown;
}

export interface RedisReaperDeps {
  db: () => Database;
  activeIds: () => Promise<string[]>;
  snapshot: (jobId: string) => Promise<JobStatusEvent | undefined>;
  queued: (jobId: string) => Promise<QueuedJob | null>;
  publish: (event: JobStatusEvent) => Promise<unknown>;
  now: () => number;
  log: (message: string) => void;
}

export interface RedisReaper {
  sweep(): Promise<void>;
}

export function redisReaperDeps(
  redis: Redis,
  queue: Pick<Queue, "getJob">,
  log: (message: string) => void,
): RedisReaperDeps {
  return {
    db: () => openDb(),
    activeIds: () => redis.smembers(ACTIVE_JOBS_KEY),
    snapshot: async (jobId) => parseStatusEvent(await redis.get(jobSnapshotKey(jobId))),
    queued: async (jobId) => {
      const job = await queue.getJob(jobId);
      return job ? { state: await job.getState(), data: job.data } : null;
    },
    publish: (event) => publishStatus(redis, event),
    now: Date.now,
    log,
  };
}

export function startRedisReaper(deps: RedisReaperDeps): () => void {
  const reaper = createRedisReaper(deps);
  const sweep = () =>
    reaper.sweep().catch((err: unknown) => deps.log(`sweep failed: ${String(err)}`));
  void sweep();
  const timer = setInterval(sweep, REAPER_INTERVAL_MS);
  return () => clearInterval(timer);
}

export function createRedisReaper(deps: RedisReaperDeps): RedisReaper {
  const missingOnce = new Set<string>();

  async function reapOrphan(jobId: string): Promise<void> {
    const db = deps.db();
    if (dbGetJob(db, jobId)) return;
    const queued = await deps.queued(jobId);
    if (queued && LIVE_STATES.has(queued.state)) return;
    const snapshot = await deps.snapshot(jobId);
    if (snapshot && isTerminal(snapshot.state)) return;
    const request = jobRequestSchema.safeParse(queued?.data);
    const stage = snapshot?.stage ?? null;
    const error = { stage: stage ?? ("generator" satisfies Stage), reason: ORPHAN_REASON };
    const at = deps.now();
    dbRecordJob(db, {
      id: jobId,
      generatorId: request.success ? request.data.generator.id : "unknown",
      params: request.success ? request.data.generator.params : undefined,
      printerId: request.success ? request.data.printerId : "",
      profileId: request.success ? request.data.profileId : "",
      state: "failed",
      stage,
      error,
      timings: snapshot?.timings,
    });
    await deps.publish({ jobId, state: "failed", stage, error, at });
    const original = dbRetryOf(db, jobId);
    if (original) {
      dbReleaseRetry(db, original, jobId);
      dbDismissJob(db, jobId, at);
    }
    deps.log(
      `recorded job ${jobId} as failed: ${queued ? `BullMQ has it ${queued.state}` : "BullMQ no longer has it"}`,
    );
  }

  async function releaseMissingRetries(): Promise<void> {
    const db = deps.db();
    const claims = dbListUnrecordedRetryClaims(db);
    const current = new Set(claims.map((claim) => claim.retriedBy));
    for (const id of missingOnce) if (!current.has(id)) missingOnce.delete(id);
    for (const { id, retriedBy } of claims) {
      if (await deps.queued(retriedBy)) {
        missingOnce.delete(retriedBy);
      } else if (!missingOnce.has(retriedBy)) {
        missingOnce.add(retriedBy);
      } else {
        missingOnce.delete(retriedBy);
        dbReleaseRetry(db, id, retriedBy);
        deps.log(`released job ${id}'s retry claim: retry ${retriedBy} was never queued`);
      }
    }
  }

  return {
    async sweep() {
      for (const jobId of await deps.activeIds()) await reapOrphan(jobId);
      await releaseMissingRetries();
    },
  };
}
