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
  createdAt: number;
  updatedAt: number;
}
