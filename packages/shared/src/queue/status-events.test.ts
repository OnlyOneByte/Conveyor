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
  tailEvents,
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

const handle = { transportId: "fake", printerId: "p1", ref: "model.gcode" };
const states = (afterSeq = 0) => tailEvents(h.db, "a", afterSeq).map((e) => e.event.state);
const queuedSnapshot = () =>
  ({ jobId: "a", state: "queued", stage: null, at: h.timing.now() }) as const;

describe("job status and events", () => {
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
