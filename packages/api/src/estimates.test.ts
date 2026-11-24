import { describe, expect, test } from "bun:test";
import type { JobStatusEvent } from "@conveyor/shared";
import type { StageDurations } from "@conveyor/shared/db";
import { type ActiveJob, withEstimates } from "./estimates";

const NOW = 1_000_000;
const TYPICAL: StageDurations = { generator: 10_000, slicer: 20_000, transport: 300_000 };

const job = (jobId: string, event: Partial<JobStatusEvent>, extra: Partial<ActiveJob> = {}) => ({
  ...{ event: { jobId, state: "queued" as const, at: NOW, ...event }, printerId: "p1" },
  ...{ generatorId: "gridfinity", createdAt: 0, ...extra },
});

const estimates = (
  jobs: ActiveJob[],
  typical = (_: ActiveJob): StageDurations => TYPICAL,
  isHeld = (_: string) => false,
) =>
  Object.fromEntries(
    withEstimates(jobs, { typical, isHeld }, NOW).map((e) => [e.jobId, e.estimate]),
  );

const printing = (secondsLeft?: number, at = NOW) =>
  job("printing", { state: "printing", stage: "transport", at, print: { secondsLeft } });

describe("when a queued job will start printing", () => {
  test("after the print ahead, with its model and slicing done meanwhile", () => {
    const second = job("second", {}, { createdAt: 2 });
    const first = job("first", {}, { createdAt: 1 });
    expect(estimates([printing(600, NOW - 100_000), second, first])).toEqual({
      printing: { typicalMs: TYPICAL },
      first: { typicalMs: TYPICAL, startsAt: NOW + 500_000 },
      second: { typicalMs: TYPICAL, startsAt: NOW + 800_000 },
    });
  });

  test("once its own model and slicing are done when the printer is free sooner", () => {
    expect(estimates([job("only", {})]).only?.startsAt).toBe(NOW + 30_000);
    const late = printing(60, NOW - 900_000);
    expect(estimates([late, job("next", {})]).next?.startsAt).toBe(NOW + 30_000);
    expect(estimates([printing(5), job("next", {})]).next?.startsAt).toBe(NOW + 30_000);
  });

  test("behind a print and a job sliced for after it, preparing only once that job takes the printer", () => {
    const slicing = job("slicing", { state: "slicing", stage: "slicer" });
    const queued = job("queued", {});
    for (const jobs of [
      [printing(600), slicing, queued],
      [queued, slicing, printing(600)],
    ]) {
      expect(estimates(jobs).queued?.startsAt).toBe(NOW + 600_000 + 300_000);
    }
    const later = job("later", {}, { createdAt: 1 });
    expect(estimates([printing(600), queued, later]).later?.startsAt).toBe(NOW + 900_000);
    const long = (_: ActiveJob): StageDurations => ({ ...TYPICAL, generator: 380_000 });
    expect(estimates([printing(600), queued, later], long).later?.startsAt).toBe(
      NOW + 600_000 + 400_000,
    );
  });

  test("after a job still slicing has sliced and printed, or one sending has printed", () => {
    const slicing = job("slicing", { state: "slicing", stage: "slicer" });
    const sending = job("sending", { state: "transferring" }, { printerId: "p2" });
    const other = job("other", {}, { printerId: "p2" });
    const result = estimates([slicing, job("next", {}), sending, other]);
    expect(result.next?.startsAt).toBe(NOW + 320_000);
    expect(result.other?.startsAt).toBe(NOW + 300_000);
  });

  test("is unknown behind a print without time left, a job without history, or a hold", () => {
    expect(estimates([printing(), job("next", {})]).next).toEqual({ typicalMs: TYPICAL });
    const unknown = job("new", {}, { createdAt: 1, generatorId: "new" });
    const result = estimates([unknown, job("after", {}, { createdAt: 2 })], (j) =>
      j.generatorId === "new" ? {} : TYPICAL,
    );
    expect(result).toEqual({ new: undefined, after: { typicalMs: TYPICAL } });
    const jobs = [job("waiting", {}), job("free", {}, { printerId: "p2" })];
    expect(estimates(jobs, undefined, (p) => p === "p1")).toEqual({
      waiting: { typicalMs: TYPICAL },
      free: { typicalMs: TYPICAL, startsAt: NOW + 30_000 },
    });
  });

  test("walks each printer on its own, and leaves out an empty estimate", () => {
    const busy = job(
      "busy",
      { state: "printing", print: { secondsLeft: 60 } },
      { generatorId: "g2" },
    );
    const jobs = [busy, job("behind", {}), job("elsewhere", {}, { printerId: "p2" })];
    const result = estimates(jobs, (j) => (j.generatorId === "g2" ? {} : TYPICAL));
    expect(result.behind?.startsAt).toBe(NOW + 60_000);
    expect(result.elsewhere?.startsAt).toBe(NOW + 30_000);
    expect(result.busy).toBeUndefined();
  });

  test("looks up typical durations once per generator and printer pair", () => {
    const asked: string[] = [];
    const typical = (j: ActiveJob) => {
      asked.push(`${j.generatorId}@${j.printerId}`);
      return TYPICAL;
    };
    const jobs = [
      job("a", {}),
      job("b", {}),
      job("c", {}, { printerId: "p2" }),
      job("d", {}, { generatorId: "g2" }),
      job("e", {}, { printerId: "p2" }),
    ];
    const result = estimates(jobs, typical);
    expect(asked).toEqual(["gridfinity@p1", "gridfinity@p2", "g2@p1"]);
    expect(Object.values(result).map((e) => e?.typicalMs)).toEqual(Array(5).fill(TYPICAL));
  });
});
