import { expect, test } from "bun:test";
import { StageError } from "@conveyor/shared";
import { harness } from "../test/helpers/pipeline-harness";
import { type JobEvent, jsonLine } from "./job-log";

const withEvents = (opts: Parameters<typeof harness>[0] = {}) => {
  const events: JobEvent[] = [];
  const h = harness({ ...opts, deps: () => ({ event: (e: JobEvent) => events.push(e) }) });
  return { h, events };
};

test("a job logs each stage it enters, then one settled line with its outcome and durations", async () => {
  const { h, events } = withEvents();
  expect(await h.run()).toBe("done");
  const settled = events.at(-1);
  expect(events.slice(0, -1).map((e) => (e.event === "stage" ? e.stage : e.event))).toEqual([
    "generator",
    "slicer",
    "transport",
  ]);
  expect(settled).toMatchObject({ event: "settled", jobId: "job-1", outcome: "done" });
  if (settled?.event !== "settled") throw new Error("no settled line");
  expect(settled.durationMs).toBeGreaterThanOrEqual(0);
  expect(settled.stages.map((s) => s.stage)).toEqual(["generator", "slicer", "transport"]);
  expect(settled.reason).toBeUndefined();
});

test("a failed job's settled line carries the failing stage and its reason", async () => {
  const { h, events } = withEvents({
    slice: async () => {
      throw new StageError("slicer", "orca exited 1: All objects are outside of the print volume.");
    },
  });
  await expect(h.run()).rejects.toThrow("orca exited 1");
  expect(events.at(-1)).toMatchObject({
    event: "settled",
    outcome: "failed",
    stage: "slicer",
    reason: "orca exited 1: All objects are outside of the print volume.",
  });
});

test("each event is one JSON line with a time and a level", () => {
  const lines: string[] = [];
  const at = () => new Date("2026-11-25T00:00:00.000Z");
  jsonLine({ event: "stage", jobId: "j1", stage: "slicer" }, (l) => lines.push(l), at);
  jsonLine(
    {
      event: "settled",
      jobId: "j1",
      outcome: "failed",
      stage: "slicer",
      durationMs: 7,
      stages: [],
    },
    (l) => lines.push(l),
    at,
  );
  expect(lines.every((l) => !l.includes("\n"))).toBe(true);
  expect(lines.map((l) => JSON.parse(l))).toEqual([
    {
      time: "2026-11-25T00:00:00.000Z",
      level: "info",
      event: "stage",
      jobId: "j1",
      stage: "slicer",
    },
    {
      time: "2026-11-25T00:00:00.000Z",
      level: "error",
      event: "settled",
      jobId: "j1",
      outcome: "failed",
      stage: "slicer",
      durationMs: 7,
      stages: [],
    },
  ]);
});
