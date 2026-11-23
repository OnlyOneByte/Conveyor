import { describe, expect, test } from "bun:test";
import type { JobStatusEvent } from "@conveyor/shared";
import type { StageDurations } from "@conveyor/shared/db";
import { type ActiveJob, withEstimates } from "./estimates";

const NOW = 1_000_000;
const TYPICAL: StageDurations = { generator: 10_000, slicer: 20_000, transport: 300_000 };

function job(
  jobId: string,
  event: Partial<JobStatusEvent>,
  extra: Partial<ActiveJob> = {},
): ActiveJob {
  return {
    event: { jobId, state: "queued", at: NOW, ...event },
    printerId: "p1",
    generatorId: "gridfinity",
    createdAt: 0,
    ...extra,
  };
}

const estimates = (jobs: ActiveJob[], lookup: (job: ActiveJob) => StageDurations = () => TYPICAL) =>
  Object.fromEntries(
    withEstimates(jobs, lookup, NOW).map((e) => [
      e.jobId,
      "estimate" in e ? e.estimate : undefined,
    ]),
  );

describe("rough start times", () => {
  test("queue behind the printing job's time left, then each job ahead's typical total", () => {
    const printing = job("printing", {
      state: "printing",
      stage: "transport",
      at: NOW - 100_000,
      print: { secondsLeft: 600 },
    });
    const second = job("second", {}, { createdAt: 2 });
    const first = job("first", {}, { createdAt: 1 });
    expect(estimates([printing, second, first])).toEqual({
      printing: { typicalMs: TYPICAL },
      first: { typicalMs: TYPICAL, startsAt: NOW + 500_000 },
      second: { typicalMs: TYPICAL, startsAt: NOW + 500_000 + 330_000 },
    });
  });

  test("start now on an idle printer, and never before now for an overdue print", () => {
    expect(estimates([job("only", {})]).only?.startsAt).toBe(NOW);
    const overdue = job("late", {
      state: "printing",
      at: NOW - 900_000,
      print: { secondsLeft: 60 },
    });
    expect(estimates([overdue, job("next", {})]).next?.startsAt).toBe(NOW);
  });

  test("count a job still slicing as its typical slicing and transport", () => {
    const slicing = job("slicing", { state: "slicing", stage: "slicer" });
    expect(estimates([slicing, job("next", {})]).next?.startsAt).toBe(NOW + 320_000);
  });

  test("give no start time behind a print without time left or a job without history", () => {
    const blind = job("blind", { state: "printing", stage: "transport" });
    expect(estimates([blind, job("next", {})]).next).toEqual({ typicalMs: TYPICAL });
    const lookup = (j: ActiveJob) => (j.event.jobId === "new-kind" ? {} : TYPICAL);
    const result = estimates(
      [job("new-kind", {}, { createdAt: 1 }), job("after", {}, { createdAt: 2 })],
      lookup,
    );
    expect(result).toEqual({ "new-kind": { startsAt: NOW }, after: { typicalMs: TYPICAL } });
  });

  test("walk each printer's queue on its own, and leave out an empty estimate", () => {
    const busy = job("busy", { state: "printing", print: { secondsLeft: 60 } });
    const elsewhere = job("elsewhere", {}, { printerId: "p2" });
    const result = estimates([busy, job("behind", {}), elsewhere], (j) =>
      j.event.jobId === "busy" ? {} : TYPICAL,
    );
    expect(result.behind?.startsAt).toBe(NOW + 60_000);
    expect(result.elsewhere?.startsAt).toBe(NOW);
    expect(result.busy).toBeUndefined();
  });
});
