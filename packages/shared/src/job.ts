import { z } from "zod";
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

export const jobRequestSchema = z.object({
  generator: z.object({ id: z.string(), params: z.unknown() }),
  printerId: z.string(),
  profileId: z.string(),
});

export type JobRequest = z.infer<typeof jobRequestSchema>;

export interface JobTarget {
  printerId: string;
  transportId: string;
  profileId: string;
  profileName: string;
  profilePath: string;
  slicerId: string;
  gcodeFlavor: string;
  allowedGenerators?: string[];
}

export interface Job {
  id: string;
  request: JobRequest;
  state: JobState;
  stage?: Stage | null;
  progress?: number;
  message?: string;
  error?: { stage: Stage; reason: string };
  artifacts?: { model?: string; gcode?: string };
  timings?: StageTiming[];
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface StageTiming {
  stage: Stage;
  enteredAt: number;
  durationMs?: number;
}

export function computeStageTimings(
  enters: { stage: Stage; at: number }[],
  settledAt?: number,
): StageTiming[] {
  return enters.map((e, i) => {
    const end = i + 1 < enters.length ? enters[i + 1].at : settledAt;
    return {
      stage: e.stage,
      enteredAt: e.at,
      durationMs: end === undefined ? undefined : Math.max(0, end - e.at),
    };
  });
}
