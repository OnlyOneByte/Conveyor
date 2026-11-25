import type { Stage, StageTiming } from "@conveyor/shared";

export type JobEvent =
  | { event: "stage"; jobId: string; stage: Stage }
  | {
      event: "settled";
      jobId: string;
      outcome: string;
      stage: Stage;
      durationMs: number;
      stages: { stage: Stage; durationMs?: number }[];
      reason?: string;
    };

export function jsonLine(
  event: JobEvent,
  write: (line: string) => void = console.log,
  now: () => Date = () => new Date(),
): void {
  const failed =
    event.event === "settled" && event.outcome !== "done" && event.outcome !== "canceled";
  write(JSON.stringify({ time: now().toISOString(), level: failed ? "error" : "info", ...event }));
}

export const stageDurations = (timings: StageTiming[]) =>
  timings.map(({ stage, durationMs }) => ({ stage, durationMs }));
