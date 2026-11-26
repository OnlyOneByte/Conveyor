import { METRICS_TIMING_SAMPLE, type StageDuration } from "@conveyor/shared/db";

export const RECENT_QUANTILES = [0.5, 0.95] as const;

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

function block(name: string, type: "counter" | "gauge", help: string, lines: string[]) {
  return [`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`, ...lines];
}

const seconds = (durations: StageDuration[], stage: string) =>
  durations
    .filter((d) => d.stage === stage)
    .map((d) => d.durationMs / 1000)
    .sort((a, b) => a - b);

export function quantile(sorted: number[], q: number): number {
  return sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)] ?? 0;
}

function quantileLines(durations: StageDuration[]): string[] {
  return STAGES.flatMap((stage) => {
    const sorted = seconds(durations, stage);
    if (sorted.length === 0) return [];
    return RECENT_QUANTILES.map(
      (q) =>
        `conveyor_recent_stage_duration_seconds{stage="${stage}",percentile="${q * 100}"} ${Number(quantile(sorted, q).toFixed(3))}`,
    );
  });
}

function sampleLines(durations: StageDuration[]): string[] {
  return STAGES.map(
    (stage) =>
      `conveyor_recent_stage_samples{stage="${stage}"} ${seconds(durations, stage).length}`,
  );
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
      "conveyor_recent_stage_duration_seconds",
      "gauge",
      `Median and 95th percentile of each stage's time over the last ${METRICS_TIMING_SAMPLE} done jobs. A moving window, not a counter: graph it as is, never rate() it.`,
      quantileLines(input.durations),
    ),
    ...block(
      "conveyor_recent_stage_samples",
      "gauge",
      "How many of those recent done jobs timed each stage.",
      sampleLines(input.durations),
    ),
  ].join("\n")}\n`;
}
