import { expect, test } from "bun:test";
import { renderMetrics } from "./metrics";

const empty = {
  finished: { done: 0, failed: 0, canceled: 0 },
  failuresByStage: [],
  live: {},
  workersUp: 0,
  durations: [],
};

test("renders Prometheus text with counts, live jobs, workers and stage histograms", () => {
  const text = renderMetrics({
    finished: { done: 3, failed: 2, canceled: 1 },
    failuresByStage: [
      { stage: "slicer", n: 1 },
      { stage: "transport", n: 1 },
    ],
    live: { queued: 2, printing: 1 },
    workersUp: 1,
    durations: [
      { stage: "slicer", durationMs: 4000 },
      { stage: "slicer", durationMs: 5000 },
      { stage: "slicer", durationMs: 90_000 },
      { stage: "transport", durationMs: 7_200_000 },
    ],
  });
  const lines = text.split("\n");
  expect(text).toEndWith("\n");
  expect(lines).toContain('conveyor_jobs_finished_total{state="done"} 3');
  expect(lines).toContain('conveyor_jobs_finished_total{state="canceled"} 1');
  expect(lines).toContain('conveyor_job_failures_total{stage="slicer"} 1');
  expect(lines).toContain('conveyor_jobs_live{state="queued"} 2');
  expect(lines).toContain("conveyor_workers_up 1");
  expect(lines).toContain('conveyor_stage_duration_seconds_bucket{stage="slicer",le="1"} 0');
  expect(lines).toContain('conveyor_stage_duration_seconds_bucket{stage="slicer",le="5"} 2');
  expect(lines).toContain('conveyor_stage_duration_seconds_bucket{stage="slicer",le="60"} 2');
  expect(lines).toContain('conveyor_stage_duration_seconds_bucket{stage="slicer",le="120"} 3');
  expect(lines).toContain('conveyor_stage_duration_seconds_bucket{stage="slicer",le="+Inf"} 3');
  expect(lines).toContain('conveyor_stage_duration_seconds_sum{stage="slicer"} 99');
  expect(lines).toContain('conveyor_stage_duration_seconds_count{stage="slicer"} 3');
  expect(lines).toContain('conveyor_stage_duration_seconds_bucket{stage="transport",le="3600"} 0');
  expect(lines).toContain('conveyor_stage_duration_seconds_bucket{stage="transport",le="+Inf"} 1');
  expect(lines).toContain('conveyor_stage_duration_seconds_count{stage="generator"} 0');
  expect(lines).toContain("# TYPE conveyor_stage_duration_seconds histogram");
});

test("a label value that isn't a plain state or stage name becomes unknown", () => {
  const text = renderMetrics({
    ...empty,
    failuresByStage: [
      { stage: null, n: 2 },
      { stage: 'x"} 9\nconveyor_evil 1', n: 1 },
    ],
    live: { 'bad"label': 4 },
  });
  expect(text).toContain('conveyor_job_failures_total{stage="unknown"} 3');
  expect(text).toContain('conveyor_jobs_live{state="unknown"} 4');
  expect(text).not.toContain("conveyor_evil");
});
