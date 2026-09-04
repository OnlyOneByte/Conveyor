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

/**
 * What the PWA submits. A job names the printer to print on and the profile to
 * slice with — nothing else is needed, because the printer determines the transport
 * and the profile determines the slicer and the g-code flavour. (This used to be a
 * single `stationId`: a saved, named (printer, profile) pairing. The pairing was
 * always fully derivable from the two ids, so the extra concept only added a
 * catalog object to curate.)
 */
export interface JobRequest {
  /** params is optional — a generator may take none (e.g. a fixed model). */
  generator: { id: string; params?: unknown };
  printerId: string;
  profileId: string;
}

/**
 * A job's print target with everything resolved: the printer and profile the
 * request named, plus the transport and slicer derived from them. Built by the API
 * and the worker from the catalog, and handed to validateJob().
 */
export interface JobTarget {
  printerId: string;
  /** from the printer row */
  transportId: string;
  profileId: string;
  /** from the profile row; passed to the slicer adapter at runtime */
  profileName: string;
  /** bundled path now; may point at a per-job materialized directory later */
  profilePath: string;
  /** from the profile row */
  slicerId: string;
  /** from the profile row — the flavour THIS profile emits */
  gcodeFlavor: string;
  /**
   * From the printer row: generator ids this printer accepts. `undefined` = no
   * restriction; `[]` = an allowlist that permits nothing.
   */
  allowedGenerators?: string[];
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
  /** Per-stage wall-clock, captured as the worker enters each stage. */
  timings?: StageTiming[];
  createdAt: number;
  updatedAt: number;
}

/**
 * One pipeline stage's wall-clock span. `enteredAt` is stamped when the worker
 * begins the stage; `durationMs` is filled once the NEXT stage starts (or the job
 * settles), so an in-flight stage has `enteredAt` set and `durationMs` undefined.
 */
export interface StageTiming {
  stage: Stage;
  /** epoch ms the stage began */
  enteredAt: number;
  /** ms spent in the stage; undefined while the stage is still running */
  durationMs?: number;
}

/**
 * Fold an ordered list of stage-enter timestamps into StageTimings. `settledAt`
 * closes the final stage (a terminal job); omit it to leave the last stage open
 * (still running). Input must be in entry order — the worker records it that way.
 */
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
