import type { StageDuration } from "@conveyor/shared/db";

export const STAGE_BUCKETS_SECONDS = [1, 5, 15, 30, 60, 120, 300, 600, 1800, 3600] as const;

const STAGES = ["generator", "slicer", "transport"] as const;

export interface MetricsInput {
  finished: { done: number; failed: number; canceled: number };
  failuresByStage: { stage: string | null; n: number }[];
  live: Record<string, number>;
  workersUp: number;
  durations: StageDuration[];
}

const NAME = /^[a-z][a-z-]*$/;

const label = (value: string | null) => (value && NAME.test(value) ? value : "unknown");

function block(
  name: string,
  type: "counter" | "gauge" | "histogram",
  help: string,
  lines: string[],
) {
  return [`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`, ...lines];
}

function durationLines(durations: StageDuration[]): string[] {
  return STAGES.flatMap((stage) => {
    const seconds = durations.filter((d) => d.stage === stage).map((d) => d.durationMs / 1000);
    const buckets = STAGE_BUCKETS_SECONDS.map(
      (le) =>
        `conveyor_stage_duration_seconds_bucket{stage="${stage}",le="${le}"} ${seconds.filter((s) => s <= le).length}`,
    );
    const sum = seconds.reduce((total, s) => total + s, 0);
    return [
      ...buckets,
      `conveyor_stage_duration_seconds_bucket{stage="${stage}",le="+Inf"} ${seconds.length}`,
      `conveyor_stage_duration_seconds_sum{stage="${stage}"} ${Number(sum.toFixed(3))}`,
      `conveyor_stage_duration_seconds_count{stage="${stage}"} ${seconds.length}`,
    ];
  });
}

export function renderMetrics(input: MetricsInput): string {
  const failures = new Map<string, number>();
  for (const { stage, n } of input.failuresByStage)
    failures.set(label(stage), (failures.get(label(stage)) ?? 0) + n);
  const live = new Map<string, number>();
  for (const [state, n] of Object.entries(input.live))
    live.set(label(state), (live.get(label(state)) ?? 0) + n);
  return `${[
    ...block(
      "conveyor_jobs_finished_total",
      "counter",
      "Jobs in history, by how they ended.",
      Object.entries(input.finished).map(
        ([state, n]) => `conveyor_jobs_finished_total{state="${state}"} ${n}`,
      ),
    ),
    ...block(
      "conveyor_job_failures_total",
      "counter",
      "Failed jobs in history, by the stage they failed in.",
      [...failures].map(([stage, n]) => `conveyor_job_failures_total{stage="${stage}"} ${n}`),
    ),
    ...block(
      "conveyor_jobs_live",
      "gauge",
      "Jobs queued or running now, by queue state.",
      [...live].map(([state, n]) => `conveyor_jobs_live{state="${state}"} ${n}`),
    ),
    ...block("conveyor_workers_up", "gauge", "Workers with a fresh heartbeat.", [
      `conveyor_workers_up ${input.workersUp}`,
    ]),
    ...block(
      "conveyor_stage_duration_seconds",
      "histogram",
      "How long each stage took, over the most recent finished jobs.",
      durationLines(input.durations),
    ),
  ].join("\n")}\n`;
}
