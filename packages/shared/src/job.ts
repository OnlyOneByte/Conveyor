import { z } from "zod";
import type { JobState } from "./job-states.js";
import type { Stage } from "./plugins.js";

export * from "./job-states.js";

export const jobRequestSchema = z.object({
  generator: z.object({ id: z.string(), params: z.unknown().optional() }),
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
  artifacts?: { model?: string; gcode?: string; log?: string };
  timings?: StageTiming[];
  filament?: FilamentUse;
  notes?: string;
  dismissedAt?: number;
  unreadable?: UnreadableColumn[];
  createdAt: number;
  updatedAt: number;
}

export type UnreadableColumn = "params" | "error" | "timings" | "stage";

export interface FilamentUse {
  grams?: number;
  metres?: number;
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
