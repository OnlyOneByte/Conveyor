import { afterEach, describe, expect, test } from "bun:test";
import { dbGetJob } from "@conveyor/shared/db";
import {
  requestCancel,
  STOP_UNCONFIRMED_REASON,
  UPLOAD_SETTLE_REASON,
} from "@conveyor/shared/queue";
import { waitForAbort } from "./pipeline-harness";
import { SLOT_WAIT_MESSAGE } from "./queue-deps";
import { bumpToken, cleanup, db, events, hold, queued, row, states } from "./queue-deps-harness";
import { LeaseLostError } from "./run";

afterEach(cleanup);

describe("a job run on the sqlite queue", () => {
  test("goes through the slot and the marker, then settles done with its artifacts", async () => {
    const h = queued({
      status: async function* () {
        yield { state: "printing", progress: 0.5 };
        yield { state: "done" };
      },
    });
    expect(await h.run()).toBe("done");
    expect(states()).toEqual([
      "queued",
      "generating",
      "generating",
      "slicing",
      "transferring",
      "transferring",
      "printing",
      "done",
    ]);
    expect(row()).toMatchObject({
      state: "done",
      lease_owner: null,
      model_path: "/tmp/model.stl",
      gcode_path: "/tmp/model.gcode",
    });
    expect(row().submit_started_at).not.toBeNull();
    expect(JSON.parse(String(row().print_handle_json))).toMatchObject({ ref: "model.gcode" });
    expect(h.submits).toBe(1);
  });

  test("writes at most one progress update per flush interval", async () => {
    const h = queued({
      slice: async (ctx) => {
        for (let i = 1; i <= 10; i++) ctx.report(i / 10);
        await Bun.sleep(80);
      },
    });
    expect(await h.run()).toBe("done");
    const slicing = events().filter((e) => e.state === "slicing");
    expect(slicing.map((e) => e.progress)).toEqual([undefined, 1]);
  });

  test("waits at the slot while another job is on the printer", async () => {
    const h = queued({
      generate: async () => {
        db.query(
          "INSERT INTO jobs (id, generator_id, printer_id, profile_id, state, created_at, updated_at) VALUES ('other', 'gen', 'p1', 'prof', 'printing', 0, 0)",
        ).run();
      },
      slice: async () => {
        setTimeout(() => db.query("UPDATE jobs SET state = 'done' WHERE id = 'other'").run(), 30);
      },
    });
    expect(await h.run()).toBe("done");
    expect(events().find((e) => e.message === SLOT_WAIT_MESSAGE)).toMatchObject({
      state: "slicing",
      progress: 1,
    });
    expect(h.submits).toBe(1);
  });

  test("a lease lost while waiting at the slot stops the wait", async () => {
    const h = queued({
      generate: async () => {
        db.query(
          "INSERT INTO jobs (id, generator_id, printer_id, profile_id, state, created_at, updated_at) VALUES ('other', 'gen', 'p1', 'prof', 'printing', 0, 0)",
        ).run();
      },
      slice: async () => {
        setTimeout(bumpToken, 40);
      },
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const spinning = new Promise((resolve) => {
      timer = setTimeout(() => resolve("still waiting"), 1500);
    });
    const outcome = await Promise.race([h.run().catch((err: unknown) => err), spinning]);
    clearTimeout(timer);
    h.controller.abort();
    expect(outcome).toBeInstanceOf(LeaseLostError);
    expect(h.submits).toBe(0);
  });

  test("a cancel the slot sees first settles canceled and submits nothing", async () => {
    const h = queued(
      { slice: async () => void requestCancel(db, "job-1") },
      { cancelRequested: async () => false },
    );
    expect(await h.run()).toBe("canceled");
    expect(row()).toMatchObject({ state: "canceled", submit_started_at: null, lease_owner: null });
    expect(h.submits).toBe(0);
    expect(hold()).toEqual({ hold_job_id: null, hold_reason: null });
  });

  test("a cancel while printing settles through settleCancel", async () => {
    const h = queued({
      status: async function* (_handle, signal) {
        yield { state: "printing", progress: 0.1 };
        requestCancel(db, "job-1");
        h.controller.abort();
        if (signal) await waitForAbort(signal);
      },
    });
    expect(await h.run()).toBe("canceled");
    expect(h.cancels).toHaveLength(1);
    expect(row()).toMatchObject({ state: "canceled", lease_owner: null });
    expect(hold()).toEqual({ hold_job_id: null, hold_reason: null });
    expect(dbGetJob(db, "job-1")?.timings?.at(-1)).toMatchObject({ stage: "transport" });
    expect(dbGetJob(db, "job-1")?.timings?.at(-1)?.durationMs).toBeNumber();
  });

  test("a cancel while waiting at the slot keeps the stage timings and clears the wait message", async () => {
    const h = queued({
      generate: async () => {
        db.query(
          "INSERT INTO jobs (id, generator_id, printer_id, profile_id, state, created_at, updated_at) VALUES ('other', 'gen', 'p1', 'prof', 'printing', 0, 0)",
        ).run();
      },
      slice: async () => {
        setTimeout(() => {
          requestCancel(db, "job-1");
          h.controller.abort();
        }, 30);
      },
    });
    expect(await h.run()).toBe("canceled");
    expect(dbGetJob(db, "job-1")?.timings?.map((t) => t.stage)).toEqual(["generator", "slicer"]);
    expect(dbGetJob(db, "job-1")?.timings?.at(-1)?.durationMs).toBeNumber();
    expect(row()).toMatchObject({ state: "canceled", progress: null, message: null });
    expect(h.submits).toBe(0);
  });

  test("a print the printer itself cancels settles canceled", async () => {
    const h = queued({
      status: async function* () {
        yield { state: "canceled" };
      },
    });
    expect(await h.run()).toBe("canceled");
    expect(row()).toMatchObject({ state: "canceled", lease_owner: null });
    expect(h.cancels).toHaveLength(0);
  });

  test("a stop the printer does not confirm fails the job and holds the printer", async () => {
    const h = queued({
      cancel: async () => {
        throw new Error("timeout");
      },
      status: async function* (_handle, signal) {
        yield { state: "printing", progress: 0.1 };
        h.controller.abort();
        if (signal) await waitForAbort(signal);
      },
    });
    expect(await h.run()).toBe("failed");
    expect(row().state).toBe("failed");
    expect(hold()).toEqual({ hold_job_id: "job-1", hold_reason: STOP_UNCONFIRMED_REASON });
  });

  test("a submit that fails inside the upload window holds the printer", async () => {
    const h = queued({
      submit: async () => {
        throw new Error("connection reset");
      },
    });
    await expect(h.run()).rejects.toThrow("connection reset");
    expect(row().state).toBe("failed");
    expect(hold()).toEqual({ hold_job_id: "job-1", hold_reason: UPLOAD_SETTLE_REASON });
    expect(h.submits).toBe(1);
  });
});
