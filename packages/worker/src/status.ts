import { Redis } from "ioredis";
import {
  jobChannel,
  jobSnapshotKey,
  type JobState,
  type JobStatusEvent,
  type Stage,
} from "@conveyor/shared";

const REDIS_URL = process.env.REDIS_URL ?? "redis://redis:6379";

/**
 * Publishes a job status event to the bus AND writes the durable snapshot so a
 * reconnecting PWA can GET /jobs/:id. State IS the contract — every transition is
 * exactly one of these messages, forwarded verbatim to the WS.
 */
export class StatusBus {
  private readonly redis = new Redis(REDIS_URL);

  async publish(
    jobId: string,
    state: JobState,
    extra: { stage?: Stage | null; progress?: number; message?: string; error?: JobStatusEvent["error"] } = {},
  ): Promise<void> {
    const evt: JobStatusEvent = { jobId, state, at: Date.now(), ...extra };
    const payload = JSON.stringify(evt);
    await this.redis
      .multi()
      .set(jobSnapshotKey(jobId), payload)
      .publish(jobChannel(jobId), payload)
      .exec();
  }
}
