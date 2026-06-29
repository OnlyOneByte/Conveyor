import type { JobState } from "./job.js";
import type { Stage } from "./plugins.js";

/**
 * One message on the Redis status bus → forwarded verbatim to the WS.
 * The PWA is a pure projection of these events.
 */
export interface JobStatusEvent {
  jobId: string;
  state: JobState;
  stage?: Stage | null;
  /** 0..1 within the current stage */
  progress?: number;
  message?: string;
  error?: { stage: Stage; reason: string };
  /** epoch ms */
  at: number;
}

/** pub/sub channel + snapshot key helpers (single source of truth for both ends). */
export function jobChannel(jobId: string): string {
  return `job:${jobId}:status`;
}

export function jobSnapshotKey(jobId: string): string {
  return `job:${jobId}`;
}
