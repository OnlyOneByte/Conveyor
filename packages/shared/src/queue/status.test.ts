import { afterEach, describe, expect, test } from "bun:test";
import { type QueueHarness, queueHarness } from "../../test/helpers/queue.ts";
import { dbUpsertPrinter } from "../db/index.ts";
import { claimJob, type Lease } from "./lease.ts";
import {
  readSnapshot,
  type StatusUpdate,
  tailEvents,
  UPLOAD_SETTLE_REASON,
  writeStatus,
} from "./status.ts";
import { markSubmitted, takePrinterSlot } from "./submit.ts";

let h: QueueHarness;
afterEach(() => h.close());

function claimed(): Lease {
  h = queueHarness();
  dbUpsertPrinter(h.db, { id: "p1", transportId: "fake", name: "P1", address: "10.0.0.2" });
  h.enqueue("a");
  const lease = claimJob(h.db, "w1", h.timing)?.lease;
  if (!lease) throw new Error("not claimed");
  return lease;
}

const holdOf = () =>
  h.db.query("SELECT hold_job_id, hold_reason FROM printers WHERE id = 'p1'").get();

const handle = { transportId: "fake", printerId: "p1", ref: "model.gcode" };
const states = (afterSeq = 0) => tailEvents(h.db, "a", afterSeq).map((e) => e.event.state);
const queuedSnapshot = () =>
  ({ jobId: "a", state: "queued", stage: null, at: h.timing.now() }) as const;

describe("job status and events", () => {
  test("enqueue records the job's first event and the snapshot's cursor points at it", () => {
    h = queueHarness();
    h.enqueue("a");
    const read = readSnapshot(h.db, "a");
    expect(read?.snapshot).toEqual(queuedSnapshot());
    expect(tailEvents(h.db, "a", 0).map((e) => e.seq)).toEqual([read?.cursor ?? -1]);
    expect(readSnapshot(h.db, "missing")).toBeNull();
  });

  test("a fenced write updates the row and appends one event", () => {
    const lease = claimed();
    const update: StatusUpdate = {
      state: "slicing",
      stage: "slicer",
      progress: 0.5,
      message: "half",
      timings: [{ stage: "slicer", enteredAt: 5 }],
    };
    expect(writeStatus(h.db, lease, update, h.timing)).toBe(true);
    expect(readSnapshot(h.db, "a")?.snapshot).toMatchObject(update);
    expect(states()).toEqual(["queued", "generating", "slicing"]);
  });

  test("never overwrites a terminal state, even under a live lease", () => {
    const lease = claimed();
    h.set("a", "state = 'canceled'");
    expect(writeStatus(h.db, lease, { state: "printing" }, h.timing)).toBe(false);
    expect(h.row("a").state).toBe("canceled");
    expect(states()).toEqual(["queued", "generating"]);
  });

  test("moves a job into the upload window only through the slot, and out only through the marker", () => {
    const lease = claimed();
    expect(writeStatus(h.db, lease, { state: "transferring" }, h.timing)).toBe(false);
    expect(writeStatus(h.db, lease, { state: "printing" }, h.timing)).toBe(false);
    h.set("a", "state = 'slicing'");
    expect(takePrinterSlot(h.db, lease, h.timing)).toBe("taken");
    for (const state of ["queued", "generating", "slicing", "printing"] as const) {
      expect(writeStatus(h.db, lease, { state }, h.timing)).toBe(false);
    }
    expect(writeStatus(h.db, lease, { state: "transferring", progress: 0.5 }, h.timing)).toBe(true);
    expect(markSubmitted(h.db, lease, handle, h.timing)).toBe(true);
    expect(writeStatus(h.db, lease, { state: "printing" }, h.timing)).toBe(true);
    expect(writeStatus(h.db, lease, { state: "slicing" }, h.timing)).toBe(false);
    expect(writeStatus(h.db, lease, { state: "transferring" }, h.timing)).toBe(false);
    expect(writeStatus(h.db, lease, { state: "canceled" }, h.timing)).toBe(false);
    expect(writeStatus(h.db, lease, { state: "done" }, h.timing)).toBe(true);
    expect(h.row("a").state).toBe("done");
    expect(holdOf()).toEqual({ hold_job_id: null, hold_reason: null });
    expect(states()).toEqual([
      "queued",
      "generating",
      "transferring",
      "transferring",
      "printing",
      "done",
    ]);
  });

  test("settles a job inside the upload window only as failed, holding its printer", () => {
    for (const state of ["done", "failed", "canceled"] as const) {
      const lease = claimed();
      h.set("a", "state = 'slicing'");
      takePrinterSlot(h.db, lease, h.timing);
      expect(writeStatus(h.db, lease, { state }, h.timing)).toBe(true);
      expect(h.row("a")).toMatchObject({ state: "failed", lease_owner: null });
      expect(JSON.parse(String(h.row("a").error_json))).toEqual({
        stage: "transport",
        reason: UPLOAD_SETTLE_REASON,
      });
      expect(states().at(-1)).toBe("failed");
      expect(holdOf()).toEqual({ hold_job_id: "a", hold_reason: UPLOAD_SETTLE_REASON });
      h.enqueue("next");
      expect(claimJob(h.db, "w2", h.timing)).toBeNull();
      h.close();
    }
    h = queueHarness();
  });

  test("fails a job before the upload window without holding its printer", () => {
    const lease = claimed();
    h.set("a", "state = 'slicing'");
    const error = { stage: "slicer", reason: "slicer crashed" } as const;
    expect(writeStatus(h.db, lease, { state: "failed", error }, h.timing)).toBe(true);
    expect(h.row("a")).toMatchObject({ state: "failed", lease_owner: null });
    expect(JSON.parse(String(h.row("a").error_json))).toEqual(error);
    expect(holdOf()).toEqual({ hold_job_id: null, hold_reason: null });
  });

  test("keeps the worker's own error when it fails a job inside the upload window", () => {
    const lease = claimed();
    h.set("a", "state = 'slicing'");
    takePrinterSlot(h.db, lease, h.timing);
    const error = { stage: "transport", reason: "connection reset" } as const;
    expect(writeStatus(h.db, lease, { state: "failed", error }, h.timing)).toBe(true);
    expect(JSON.parse(String(h.row("a").error_json))).toEqual(error);
    expect(holdOf()).toEqual({ hold_job_id: "a", hold_reason: UPLOAD_SETTLE_REASON });
  });

  test("a write without a live lease changes nothing and appends nothing", () => {
    const lease = claimed();
    const slicing: StatusUpdate = { state: "slicing" };
    expect(writeStatus(h.db, { ...lease, token: lease.token - 1 }, slicing, h.timing)).toBe(false);
    expect(writeStatus(h.db, { ...lease, owner: "w2" }, slicing, h.timing)).toBe(false);
    h.advance(30_001);
    expect(writeStatus(h.db, lease, slicing, h.timing)).toBe(false);
    expect(h.row("a").state).toBe("generating");
    expect(states()).toEqual(["queued", "generating"]);
  });

  test("a write whose event cannot be stored leaves the row unchanged", () => {
    const lease = claimed();
    h.db.exec(
      "CREATE TRIGGER no_events BEFORE INSERT ON job_events BEGIN SELECT RAISE(ABORT, 'no events'); END",
    );
    expect(() => writeStatus(h.db, lease, { state: "slicing" }, h.timing)).toThrow("no events");
    expect(h.row("a").state).toBe("generating");
  });

  test("settling clears the lease, and nothing is written after a terminal state", () => {
    const lease = claimed();
    const error = { stage: "transport", reason: "thermal runaway" } as const;
    const failed: StatusUpdate = { state: "failed", stage: "transport", error };
    expect(writeStatus(h.db, lease, failed, h.timing)).toBe(true);
    expect(h.row("a")).toMatchObject({ state: "failed", lease_owner: null, lease_until: null });
    expect(Number(h.row("a").lease_token)).toBe(lease.token + 1);
    expect(readSnapshot(h.db, "a")?.snapshot.error).toEqual(error);
    const after = { ...lease, token: lease.token + 1 };
    expect(writeStatus(h.db, after, { state: "printing" }, h.timing)).toBe(false);
    expect(states()).toEqual(["queued", "generating", "failed"]);
  });
});
