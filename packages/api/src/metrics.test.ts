import { expect, test } from "bun:test";
import { quantile, renderMetrics } from "./metrics";

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
      { stage: "slicer", durationMs: 90_000 },
      { stage: "slicer", durationMs: 4000 },
      { stage: "slicer", durationMs: 5000 },
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
  expect(lines).toContain(
    'conveyor_recent_stage_duration_seconds{stage="slicer",percentile="50"} 5',
  );
  expect(lines).toContain(
    'conveyor_recent_stage_duration_seconds{stage="slicer",percentile="95"} 90',
  );
  expect(lines).toContain(
    'conveyor_recent_stage_duration_seconds{stage="transport",percentile="50"} 7200',
  );
  expect(lines).toContain('conveyor_recent_stage_samples{stage="slicer"} 3');
  expect(lines).toContain('conveyor_recent_stage_samples{stage="generator"} 0');
  expect(text).not.toContain('stage="generator",percentile');
  expect(lines).toContain("# TYPE conveyor_recent_stage_duration_seconds gauge");
  expect(text).not.toContain("histogram");
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

test("quantiles use the nearest rank of the sorted durations", () => {
  expect(quantile([1, 2, 3, 4], 0.5)).toBe(2);
  expect(quantile([1, 2, 3, 4], 0.95)).toBe(4);
  expect(quantile([7], 0.5)).toBe(7);
  expect(
    quantile(
      Array.from({ length: 100 }, (_, i) => i + 1),
      0.95,
    ),
  ).toBe(95);
});
