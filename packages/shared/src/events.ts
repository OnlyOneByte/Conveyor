import type { JobState } from "./job.js";
import type { StageTiming } from "./job.js";
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
  /**
   * Per-stage wall-clock so far (open final stage while running). Present on live
   * events once the worker has entered its first stage; a monitoring view reads it
   * to show "3m in slicing" without waiting for the job to settle.
   */
  timings?: StageTiming[];
  /** epoch ms */
  at: number;
}

/** BullMQ queue name — shared by the api (producer) and worker (consumer).
 *  NB: BullMQ forbids ':' in queue names, so this uses a hyphen. */
export const JOB_QUEUE = "conveyor-jobs";

/** pub/sub channel + snapshot key helpers (single source of truth for both ends). */
export function jobChannel(jobId: string): string {
  return `job:${jobId}:status`;
}

export function jobSnapshotKey(jobId: string): string {
  return `job:${jobId}`;
}

/**
 * A Redis set of the job ids that are currently in flight. The worker adds an id
 * when it starts a job and removes it on any terminal state; the API reads the set
 * (then each job's snapshot) to answer GET /jobs/active without scanning keys.
 * A set (not a key scan) keeps the read O(active jobs), and a stale id simply
 * resolves to a terminal snapshot the API filters out.
 */
export const ACTIVE_JOBS_KEY = "jobs:active";
