import type { Stage } from "./plugins.js";

export const JOB_STATES = [
  "queued",
  "generating",
  "slicing",
  "transferring",
  "printing",
  "done",
  "failed",
  "canceled",
] as const;

export type JobState = (typeof JOB_STATES)[number];

export const TERMINAL_STATES: readonly JobState[] = ["done", "failed", "canceled"];

export function isTerminal(state: JobState): boolean {
  return TERMINAL_STATES.includes(state);
}

/** What the PWA submits. The station resolves slicer + profile + printer. */
export interface JobRequest {
  /** params is optional — a generator may take none (e.g. a fixed model). */
  generator: { id: string; params?: unknown };
  stationId: string;
}

/** Durable job record (persisted to SQLite on terminal state). */
export interface Job {
  id: string;
  request: JobRequest;
  state: JobState;
  stage?: Stage | null;
  progress?: number;
  message?: string;
  error?: { stage: Stage; reason: string };
  artifacts?: { model?: string; gcode?: string };
  createdAt: number;
  updatedAt: number;
}
