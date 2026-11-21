import type { JobState, StageTiming } from "./job.js";
import type { Stage } from "./plugins.js";

export interface JobStatusEvent {
  jobId: string;
  state: JobState;
  stage?: Stage | null;
  progress?: number;
  message?: string;
  error?: { stage: Stage; reason: string };
  timings?: StageTiming[];
  at: number;
}

export const JOB_QUEUE = "conveyor-jobs";

export function jobChannel(jobId: string): string {
  return `job:${jobId}:status`;
}

export function jobSnapshotKey(jobId: string): string {
  return `job:${jobId}`;
}

export const ACTIVE_JOBS_KEY = "jobs:active";
