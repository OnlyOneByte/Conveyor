import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { type QueueHarness, queueHarness } from "../../test/helpers/queue.ts";
import { dbUpsertPrinter } from "../db/index.ts";
import { claimJob, DEFAULT_TIMING, type Lease, releaseLease } from "./lease.ts";
import { reapExpired } from "./reaper.ts";
import {
  EVENT_RETENTION_MS,
  pruneEvents,
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

  test("tailing from a snapshot's cursor yields each later event exactly once, in order", () => {
    const lease = claimed();
    writeStatus(h.db, lease, { state: "slicing" }, h.timing);
    const { cursor } = readSnapshot(h.db, "a") ?? { cursor: -1 };
    takePrinterSlot(h.db, lease, h.timing);
    markSubmitted(h.db, lease, handle, h.timing);
    writeStatus(h.db, lease, { state: "printing", progress: 0.1 }, h.timing);
    const tailed = tailEvents(h.db, "a", cursor);
    expect(tailed.map((e) => e.event.state)).toEqual(["transferring", "printing"]);
    expect(tailed[0]?.seq).toBeGreaterThan(cursor);
    expect(tailEvents(h.db, "a", tailed[1]?.seq ?? 0)).toEqual([]);
  });

  test("a requeue is recorded and clears the snapshot's stage, progress and message", () => {
    const lease = claimed();
    const busy = { state: "slicing", stage: "slicer", progress: 0.4, message: "x" } as const;
    writeStatus(h.db, lease, busy, h.timing);
    expect(releaseLease(h.db, lease, h.timing)).toBe("requeued");
    expect(readSnapshot(h.db, "a")?.snapshot).toEqual(queuedSnapshot());
    const next = claimJob(h.db, "w1", h.timing)?.lease;
    if (!next) throw new Error("not claimed again");
    writeStatus(h.db, next, busy, h.timing);
    h.advance(30_001);
    reapExpired(h.db, h.timing);
    expect(readSnapshot(h.db, "a")?.snapshot).toEqual(queuedSnapshot());
    const cycle = ["queued", "generating", "slicing"] as const;
    expect(states()).toEqual([...cycle, ...cycle, "queued"]);
  });

  test("the reaper's requeue and failure are recorded as events", () => {
    claimed();
    for (let i = 0; i < 3; i++) {
      h.advance(30_001);
      reapExpired(h.db, h.timing);
      h.advance(10_000);
      claimJob(h.db, "w1", h.timing);
    }
    h.advance(30_001);
    reapExpired(h.db, h.timing);
    const events = tailEvents(h.db, "a", 0).map((e) => e.event);
    expect(events.map((e) => e.state)).toEqual([
      "queued",
      "generating",
      "queued",
      "generating",
      "queued",
      "generating",
      "failed",
    ]);
    expect(events.at(-1)?.error?.reason).toContain("before it reached the printer");
  });

  test("prunes only the events of jobs settled longer ago than the retention", () => {
    const lease = claimed();
    writeStatus(h.db, lease, { state: "done" }, h.timing);
    h.enqueue("b", "p2");
    h.advance(EVENT_RETENTION_MS);
    expect(pruneEvents(h.db, h.timing)).toBe(0);
    h.advance(1);
    expect(pruneEvents(h.db, h.timing)).toBe(3);
    expect(tailEvents(h.db, "a", 0)).toEqual([]);
    expect(tailEvents(h.db, "b", 0)).toHaveLength(1);
  });

  test("refuses to return a stored event that is not a valid status event", () => {
    h = queueHarness();
    h.db.exec(
      "INSERT INTO job_events (job_id, event, at) VALUES ('a', '{\"state\":\"bogus\"}', 0)",
    );
    expect(() => tailEvents(h.db, "a", 0)).toThrow("is not a valid job status event");
  });

  test("every snapshot agrees with the event at its cursor while another process writes", async () => {
    h = queueHarness();
    h.enqueue("a");
    const timing = { ...DEFAULT_TIMING, leaseMs: 600_000, now: Date.now };
    const lease = claimJob(h.db, "w1", timing)?.lease;
    if (!lease) throw new Error("not claimed");
    const writer = Bun.spawn(
      [
        process.execPath,
        "-e",
        `const { openDb } = require(process.env.DB_MODULE);
         const { writeStatus } = require(process.env.STATUS_MODULE);
         const db = openDb(process.env.DB_FILE);
         const lease = JSON.parse(process.env.LEASE);
         const timing = { leaseMs: 600000, backoffBaseMs: 5000, now: Date.now };
         for (let i = 1; i <= 3000; i++)
           writeStatus(db, lease, { state: "slicing", progress: i / 3000 }, timing);`,
      ],
      {
        env: {
          ...process.env,
          DB_FILE: h.path,
          DB_MODULE: join(import.meta.dir, "..", "db", "index.ts"),
          STATUS_MODULE: join(import.meta.dir, "status.ts"),
          LEASE: JSON.stringify(lease),
        },
      },
    );
    let reads = 0;
    let mismatches = 0;
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      const read = readSnapshot(h.db, "a");
      const atCursor = tailEvents(h.db, "a", (read?.cursor ?? 0) - 1, 1)[0]?.event;
      reads++;
      const same =
        atCursor?.state === read?.snapshot.state && atCursor?.progress === read?.snapshot.progress;
      if (!same) mismatches++;
      if (read?.snapshot.progress === 1) break;
    }
    expect(await writer.exited).toBe(0);
    expect(mismatches).toBe(0);
    expect(reads).toBeGreaterThan(100);
    const seqs = tailEvents(h.db, "a", 0, 10_000).map((e) => e.seq);
    expect(seqs).toHaveLength(3002);
    expect(new Set(seqs).size).toBe(3002);
  }, 30_000);
});
