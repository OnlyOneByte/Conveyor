import type { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dbGetJob, dbUpsertPrinter, openDb } from "@conveyor/shared/db";
import {
  claimJob,
  enqueueJob,
  type Lease,
  markSubmitted,
  RESUME_FAILED_REASON,
  releaseLease,
  requestCancel,
  STOP_UNCONFIRMED_REASON,
  tailEvents,
  takePrinterSlot,
  UPLOAD_SETTLE_REASON,
} from "@conveyor/shared/queue";
import { type HarnessOptions, harness, req, waitForAbort } from "./pipeline-harness";
import { RESUMED_MESSAGE } from "./print";
import { queueDeps, SLOT_WAIT_MESSAGE } from "./queue-deps";
import { LeaseLostError, type PipelineDeps } from "./run";

let db: Database;
let dir: string;
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function queued(opts: HarnessOptions = {}, overrides: Partial<PipelineDeps> = {}) {
  dir = mkdtempSync(join(tmpdir(), "conveyor-worker-queue-"));
  db = openDb(join(dir, "conveyor.db"));
  dbUpsertPrinter(db, { id: "p1", transportId: "tr", name: "P1", address: "10.0.0.9" });
  enqueueJob(db, { id: "job-1", request: req });
  const lease = opts.resume ? orphanLease() : claim("w1");
  return harness({
    ...opts,
    deps: (h) => ({
      ...queueDeps({
        db,
        lease,
        controller: h.controller,
        log: () => {},
        progressFlushMs: 50,
        slotRetryMs: 5,
      }).deps,
      ...overrides,
    }),
  });
}

function claim(owner: string): Lease {
  const claimed = claimJob(db, owner);
  if (!claimed) throw new Error("not claimed");
  return claimed.lease;
}

function orphanLease(): Lease {
  const first = claim("w0");
  db.query("UPDATE jobs SET state = 'slicing' WHERE id = 'job-1'").run();
  takePrinterSlot(db, first);
  markSubmitted(db, first, { transportId: "tr", printerId: "p1", ref: "model.gcode" });
  releaseLease(db, first);
  return claim("w1");
}

const row = () =>
  db.query<Record<string, unknown>, []>("SELECT * FROM jobs WHERE id = 'job-1'").get() ?? {};
const events = () => tailEvents(db, "job-1", 0).map((e) => e.event);
const states = () => events().map((e) => e.state);
const bumpToken = () =>
  db.query("UPDATE jobs SET lease_token = lease_token + 1 WHERE id = 'job-1'").run();
const hold = () => db.query("SELECT hold_job_id, hold_reason FROM printers WHERE id = 'p1'").get();

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

  test("a slot the queue refuses never reaches submit()", async () => {
    const h = queued({
      slice: async () => {
        db.query("UPDATE jobs SET submit_started_at = 1 WHERE id = 'job-1'").run();
      },
    });
    await expect(h.run()).rejects.toThrow("printer slot refused");
    expect(h.submits).toBe(0);
  });

  test("a refused marker stops the run before it watches the print", async () => {
    let watched = false;
    const h = queued({
      submit: async () => void bumpToken(),
      status: async function* () {
        watched = true;
        yield { state: "done" };
      },
    });
    await expect(h.run()).rejects.toBeInstanceOf(LeaseLostError);
    expect(row().submitted_at).toBeNull();
    expect(watched).toBe(false);
  });

  test("a refused status write aborts the running engine", async () => {
    let first = "";
    const h = queued({
      generate: async () => void bumpToken(),
      slice: async (ctx) => {
        first = await Promise.race([
          waitForAbort(ctx.signal).catch(() => "aborted"),
          Bun.sleep(500).then(() => "still running"),
        ]);
      },
    });
    await expect(h.run()).rejects.toBeInstanceOf(LeaseLostError);
    expect(first).toBe("aborted");
  });

  test("a refused terminal write is a lost lease, not done, and records nothing", async () => {
    const h = queued({
      status: async function* () {
        yield { state: "printing", progress: 0.5 };
        bumpToken();
        yield { state: "done" };
      },
    });
    await expect(h.run()).rejects.toBeInstanceOf(LeaseLostError);
    expect(row()).toMatchObject({ state: "printing", model_path: null });
  });

  test("a cancel that settleCancel refuses is a lost lease, not canceled", async () => {
    const h = queued({
      status: async function* (_handle, signal) {
        yield { state: "printing", progress: 0.1 };
        bumpToken();
        requestCancel(db, "job-1");
        h.controller.abort();
        if (signal) await waitForAbort(signal);
      },
    });
    await expect(h.run()).rejects.toBeInstanceOf(LeaseLostError);
    expect(row().state).toBe("printing");
  });

  test("progress still pending at a new state or at the marker is dropped, not flushed late", async () => {
    const h = queued({
      slice: async (ctx) => {
        ctx.report(0.4);
        ctx.report(0.8);
      },
      submit: async (ctx) => {
        await Bun.sleep(80);
        ctx.report(0.4);
        ctx.report(0.8);
      },
      status: async function* () {
        await Bun.sleep(120);
        yield { state: "printing", progress: 0.5 };
        yield { state: "done" };
      },
    });
    expect(await h.run()).toBe("done");
  });

  test("a lost lease stops the run without writing anything more", async () => {
    const h = queued({
      slice: async () => {
        db.query("UPDATE jobs SET lease_token = lease_token + 1 WHERE id = 'job-1'").run();
      },
    });
    await expect(h.run()).rejects.toBeInstanceOf(LeaseLostError);
    expect(row().state).toBe("slicing");
    expect(row()).toMatchObject({ submit_started_at: null, cancel_requested_at: null });
    expect(h.submits).toBe(0);
  });
});

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
