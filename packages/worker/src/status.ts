import {
  type JobState,
  type JobStatusEvent,
  publishStatus,
  type Stage,
  type StageTiming,
} from "@conveyor/shared";
import type { Redis } from "ioredis";

export class StatusBus {
  constructor(private readonly redis: Redis) {}

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
