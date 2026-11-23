import { afterEach, describe, expect, test } from "bun:test";
import { dbGetJob } from "@conveyor/shared/db";
import { RESUME_FAILED_REASON, requestCancel } from "@conveyor/shared/queue";
import { waitForAbort } from "../test/helpers/pipeline-harness";
import {
  bumpToken,
  cleanup,
  db,
  events,
  hold,
  queued,
  row,
} from "../test/helpers/queue-deps-harness";
import { RESUMED_MESSAGE } from "./print";
import { LeaseLostError } from "./run";

afterEach(cleanup);

describe("resuming a job that was already on the printer", () => {
  test("keeps the job's artifacts and stage timings through a resumed done", async () => {
    const h = queued({ resume: true });
    const timings = [
      { stage: "generator", enteredAt: 1, durationMs: 4 },
      { stage: "slicer", enteredAt: 5, durationMs: 5 },
      { stage: "transport", enteredAt: 10 },
    ];
    db.query(
      "UPDATE jobs SET model_path = '/data/m.stl', gcode_path = '/data/m.gcode', timings_json = ? WHERE id = 'job-1'",
    ).run(JSON.stringify(timings));
    expect(await h.run()).toBe("done");
    const job = dbGetJob(db, "job-1");
    expect(job?.artifacts).toEqual({ model: "/data/m.stl", gcode: "/data/m.gcode" });
    expect(job?.timings?.map((t) => t.stage)).toEqual(["generator", "slicer", "transport"]);
    expect(job?.timings?.[1]?.durationMs).toBe(5);
    expect(job?.timings?.[2]?.durationMs).toBeNumber();
  });

  test("fails and holds the printer when the stored transport is unknown", async () => {
    const h = queued({ resume: true });
    db.query(
      `UPDATE jobs SET print_handle_json = '{"transportId":"gone","printerId":"p1","ref":"model.gcode"}' WHERE id = 'job-1'`,
    ).run();
    expect(await h.run()).toBe("failed");
    expect(hold()).toEqual({ hold_job_id: "job-1", hold_reason: RESUME_FAILED_REASON });
  });

  test("fails and holds the printer when the printer cannot be resolved", async () => {
    const h = queued(
      { resume: true },
      {
        resolvePrinter: async () => {
          throw new Error("unknown printer p1");
        },
      },
    );
    expect(await h.run()).toBe("failed");
    expect(hold()).toEqual({ hold_job_id: "job-1", hold_reason: RESUME_FAILED_REASON });
  });

  test("a failed resume whose lease is gone reports the lost lease and holds nothing", async () => {
    const h = queued(
      { resume: true },
      {
        resolvePrinter: async () => {
          bumpToken();
          throw new Error("unknown printer p1");
        },
      },
    );
    await expect(h.run()).rejects.toBeInstanceOf(LeaseLostError);
    expect(hold()).toEqual({ hold_job_id: null, hold_reason: null });
  });

  test("watches the stored handle and never submits again", async () => {
    const h = queued({
      resume: true,
      status: async function* () {
        yield { state: "printing", progress: 0.7 };
        yield { state: "done" };
      },
    });
    expect(await h.run()).toBe("done");
    expect(h.submits).toBe(0);
    expect(h.generated).toBe(0);
    expect(events().find((e) => e.message === RESUMED_MESSAGE)?.state).toBe("printing");
    expect(row()).toMatchObject({ state: "done", lease_owner: null });
  });

  for (const [name, status] of [
    [
      "the first status read fails",
      async function* () {
        yield* [];
        throw new Error("ECONNREFUSED");
      },
    ],
    ["the status stream ends at once", async function* () {}],
  ] as const) {
    test(`fails and holds the printer when ${name}`, async () => {
      const h = queued({ resume: true, status });
      expect(await h.run()).toBe("failed");
      expect(h.submits).toBe(0);
      expect(JSON.parse(String(row().error_json)).reason).toBe(RESUME_FAILED_REASON);
      expect(hold()).toEqual({ hold_job_id: "job-1", hold_reason: RESUME_FAILED_REASON });
    });
  }

  test("a cancel before the first status stops the printer instead of failing the resume", async () => {
    const h = queued({
      resume: true,
      status: async function* (_handle, signal) {
        requestCancel(db, "job-1");
        h.controller.abort();
        if (signal) await waitForAbort(signal);
        yield* [];
      },
    });
    expect(await h.run()).toBe("canceled");
    expect(h.cancels).toHaveLength(1);
    expect(hold()).toEqual({ hold_job_id: null, hold_reason: null });
  });

  test("fails and holds the printer when the stored handle is unreadable", async () => {
    const h = queued({ resume: true });
    db.query("UPDATE jobs SET print_handle_json = '{}' WHERE id = 'job-1'").run();
    expect(await h.run()).toBe("failed");
    expect(hold()).toEqual({ hold_job_id: "job-1", hold_reason: RESUME_FAILED_REASON });
  });

  test("a failure after the first status fails the job without a hold", async () => {
    const h = queued({
      resume: true,
      status: async function* () {
        yield { state: "printing", progress: 0.7 };
        throw new Error("socket reset");
      },
    });
    await expect(h.run()).rejects.toThrow("socket reset");
    expect(row().state).toBe("failed");
    expect(hold()).toEqual({ hold_job_id: null, hold_reason: null });
  });
});
