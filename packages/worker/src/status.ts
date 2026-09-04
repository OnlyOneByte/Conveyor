import { Redis } from "ioredis";
import {
  ACTIVE_JOBS_KEY,
  isTerminal,
  jobChannel,
  jobSnapshotKey,
  type JobState,
  type JobStatusEvent,
  type Stage,
  type StageTiming,
} from "@conveyor/shared";

const REDIS_URL = process.env.REDIS_URL ?? "redis://redis:6379";

/**
 * Publishes a job status event to the bus AND writes the durable snapshot so a
 * reconnecting PWA can GET /jobs/:id. State IS the contract — every transition is
 * exactly one of these messages, forwarded verbatim to the WS.
 *
 * It also maintains the `jobs:active` set (add on any non-terminal publish, remove on
 * a terminal one) so GET /jobs/active is an O(active) read rather than a key scan. The
 * set membership rides inside the same MULTI as the snapshot write, so the index and
 * the snapshot can never disagree about whether a job is live.
 */
export class StatusBus {
  private readonly redis = new Redis(REDIS_URL);

  async publish(
    jobId: string,
    state: JobState,
    extra: {
      stage?: Stage | null;
      progress?: number;
      message?: string;
      error?: JobStatusEvent["error"];
      timings?: StageTiming[];
    } = {},
  ): Promise<void> {
    const evt: JobStatusEvent = { jobId, state, at: Date.now(), ...extra };
    const payload = JSON.stringify(evt);
    const tx = this.redis
      .multi()
      .set(jobSnapshotKey(jobId), payload)
      .publish(jobChannel(jobId), payload);
    if (isTerminal(state)) tx.srem(ACTIVE_JOBS_KEY, jobId);
    else tx.sadd(ACTIVE_JOBS_KEY, jobId);
    await tx.exec();
  }
}
