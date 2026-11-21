import {
  type JobState,
  type JobStatusEvent,
  publishStatus,
  type Stage,
  type StageTiming,
} from "@conveyor/shared";
import { Redis } from "ioredis";

const REDIS_URL = process.env.REDIS_URL ?? "redis://redis:6379";

/**
 * Publishes a job status event to the bus AND writes the durable snapshot so a
 * reconnecting PWA can GET /jobs/:id. State IS the contract — every transition is
 * exactly one of these messages, forwarded verbatim to the WS.
 *
 * It also maintains the `jobs:active` set (add on any non-terminal publish, remove on
 * a terminal one) so GET /jobs/active is an O(active) read rather than a key scan. The
 * set membership rides inside the same Lua script as the snapshot write, so the index and
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
  ): Promise<boolean> {
    return publishStatus(this.redis, { jobId, state, at: Date.now(), ...extra });
  }
}
