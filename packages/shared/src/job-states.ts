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
