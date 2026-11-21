import { afterEach, describe, expect, test } from "bun:test";
import { holdWriteLock, type QueueHarness, queueHarness } from "../../test/helpers/queue.ts";
import { dbUpsertPrinter } from "../db/index.ts";
import {
  isCancelRequested,
  requestCancel,
  STOP_UNCONFIRMED_REASON,
  settleCancel,
} from "./cancel.ts";
import { claimJob, type Lease } from "./lease.ts";
import { tailEvents, writeStatus } from "./status.ts";
import { takePrinterSlot } from "./submit.ts";

let h: QueueHarness;
afterEach(() => h.close());

const lastState = (id = "a") => tailEvents(h.db, id, 0).at(-1)?.event.state;
const holdOf = () =>
  h.db.query("SELECT hold_job_id, hold_reason FROM printers WHERE id = 'p1'").get();

function slicing(): Lease {
  h = queueHarness();
  dbUpsertPrinter(h.db, { id: "p1", transportId: "fake", name: "P1", address: "10.0.0.2" });
  h.enqueue("a");
  const lease = claimJob(h.db, "w1", h.timing)?.lease;
  if (!lease) throw new Error("not claimed");
  h.set("a", "state = 'slicing'");
  return lease;
}

describe("requestCancel", () => {
  test("cancels a queued job at once, so no claim can take it", () => {
    h = queueHarness();
    h.enqueue("a");
    expect(requestCancel(h.db, "a", h.timing)).toEqual({ kind: "canceled" });
    expect(h.row("a")).toMatchObject({ state: "canceled", cancel_requested_at: h.timing.now() });
    expect(lastState()).toBe("canceled");
    expect(claimJob(h.db, "w1", h.timing)).toBeNull();
  });

  test("flags a job in flight once, and leaves its state to the worker", () => {
    const lease = slicing();
    expect(isCancelRequested(h.db, "a")).toBe(false);
    expect(requestCancel(h.db, "a", h.timing)).toEqual({ kind: "canceling" });
    const first = h.timing.now();
    h.advance(1_000);
    expect(requestCancel(h.db, "a", h.timing)).toEqual({ kind: "canceling" });
    expect(h.row("a")).toMatchObject({
      state: "slicing",
      cancel_requested_at: first,
      lease_owner: lease.owner,
    });
    expect(isCancelRequested(h.db, "a")).toBe(true);
  });

  test("answers a settled job with its state and an unknown job as unknown, writing nothing", () => {
    h = queueHarness();
    h.enqueue("a");
    h.set("a", "state = 'done'");
    expect(requestCancel(h.db, "a", h.timing)).toEqual({ kind: "settled", state: "done" });
    expect(h.row("a").cancel_requested_at).toBeNull();
    expect(requestCancel(h.db, "missing", h.timing)).toEqual({ kind: "unknown" });
  });

  test("waits for the write lock before it reads", async () => {
    h = queueHarness();
    const holder = await holdWriteLock(h.path);
    const calledAt = Date.now();
    expect(requestCancel(h.db, "missing", h.timing)).toEqual({ kind: "unknown" });
    expect(Date.now() - calledAt).toBeGreaterThanOrEqual(200);
    expect(await holder.exited).toBe(0);
  });
});

describe("cancel before the printer slot", () => {
  test("a canceled job never takes the slot, so nothing is submitted", () => {
    const lease = slicing();
    requestCancel(h.db, "a", h.timing);
    expect(takePrinterSlot(h.db, lease, h.timing)).toBe("canceled");
    expect(h.row("a")).toMatchObject({ state: "slicing", submit_started_at: null });
    expect(settleCancel(h.db, lease, false, h.timing)).toBe("canceled");
    expect(holdOf()).toEqual({ hold_job_id: null, hold_reason: null });
    expect(takePrinterSlot(h.db, lease, h.timing)).toBe("lost");
  });
});

describe("settleCancel after the job reached the printer", () => {
  test("settles canceled when the printer confirms the stop", () => {
    const lease = slicing();
    takePrinterSlot(h.db, lease, h.timing);
    requestCancel(h.db, "a", h.timing);
    expect(settleCancel(h.db, lease, true, h.timing)).toBe("canceled");
    expect(h.row("a")).toMatchObject({ state: "canceled", lease_owner: null, lease_until: null });
    expect(Number(h.row("a").lease_token)).toBe(lease.token + 1);
    expect(lastState()).toBe("canceled");
    expect(holdOf()).toEqual({ hold_job_id: null, hold_reason: null });
  });

  test("fails the job and holds the printer when the stop is not confirmed", () => {
    const lease = slicing();
    takePrinterSlot(h.db, lease, h.timing);
    requestCancel(h.db, "a", h.timing);
    expect(settleCancel(h.db, lease, false, h.timing)).toBe("failed");
    expect(JSON.parse(String(h.row("a").error_json))).toEqual({
      stage: "transport",
      reason: STOP_UNCONFIRMED_REASON,
    });
    expect(lastState()).toBe("failed");
    expect(holdOf()).toEqual({ hold_job_id: "a", hold_reason: STOP_UNCONFIRMED_REASON });
    h.enqueue("next");
    h.set("a", "state = 'done'");
    expect(claimJob(h.db, "w2", h.timing)).toBeNull();
  });

  test("settles nothing without a cancel request or a live lease", () => {
    const lease = slicing();
    takePrinterSlot(h.db, lease, h.timing);
    expect(settleCancel(h.db, lease, true, h.timing)).toBeNull();
    requestCancel(h.db, "a", h.timing);
    expect(settleCancel(h.db, { ...lease, token: lease.token - 1 }, true, h.timing)).toBeNull();
    h.advance(30_001);
    expect(settleCancel(h.db, lease, true, h.timing)).toBeNull();
    expect(h.row("a").state).toBe("transferring");
  });

  test("never settles a job that already settled", () => {
    const lease = slicing();
    requestCancel(h.db, "a", h.timing);
    writeStatus(h.db, lease, { state: "failed" }, h.timing);
    expect(settleCancel(h.db, { ...lease, token: lease.token + 1 }, true, h.timing)).toBeNull();
    expect(h.row("a").state).toBe("failed");
  });
});
