import { afterEach, describe, expect, test } from "bun:test";
import { type QueueHarness, queueHarness } from "../../test/helpers/queue.ts";
import { claimJob, type Lease } from "./lease.ts";
import { reapExpired } from "./reaper.ts";
import {
  EVENT_RETENTION_MS,
  pruneEvents,
  readSnapshot,
  tailEvents,
  writeStatus,
} from "./status.ts";

let h: QueueHarness;
afterEach(() => h.close());

function claimed(): Lease {
  h = queueHarness();
  h.enqueue("a");
  const lease = claimJob(h.db, "w1", h.timing)?.lease;
  if (!lease) throw new Error("not claimed");
  return lease;
}

const states = (afterSeq = 0) => tailEvents(h.db, "a", afterSeq).map((e) => e.event.state);

describe("job status and events", () => {
  test("enqueue records the job's first event and the snapshot's cursor points at it", () => {
    h = queueHarness();
    h.enqueue("a");
    const read = readSnapshot(h.db, "a");
    expect(read?.snapshot).toEqual({
      jobId: "a",
      state: "queued",
      stage: null,
      at: h.timing.now(),
    });
    expect(tailEvents(h.db, "a", 0).map((e) => e.seq)).toEqual([read?.cursor ?? -1]);
    expect(readSnapshot(h.db, "missing")).toBeNull();
  });

  test("a fenced write updates the row and appends one event", () => {
    const lease = claimed();
    const update = { state: "slicing", stage: "slicer", progress: 0.5, message: "half" } as const;
    expect(writeStatus(h.db, lease, update, h.timing)).toBe(true);
    expect(readSnapshot(h.db, "a")?.snapshot).toMatchObject(update);
    expect(states()).toEqual(["queued", "slicing"]);
  });

  test("never overwrites a terminal state, even under a live lease", () => {
    const lease = claimed();
    h.set("a", "state = 'canceled'");
    expect(writeStatus(h.db, lease, { state: "printing" }, h.timing)).toBe(false);
    expect(h.row("a").state).toBe("canceled");
    expect(states()).toEqual(["queued"]);
  });

  test("a write without a live lease changes nothing and appends nothing", () => {
    const lease = claimed();
    expect(
      writeStatus(h.db, { ...lease, token: lease.token - 1 }, { state: "slicing" }, h.timing),
    ).toBe(false);
    h.advance(30_001);
    expect(writeStatus(h.db, lease, { state: "slicing" }, h.timing)).toBe(false);
    expect(h.row("a").state).toBe("generating");
    expect(states()).toEqual(["queued"]);
  });

  test("settling clears the lease, and nothing is written after a terminal state", () => {
    const lease = claimed();
    const error = { stage: "transport", reason: "thermal runaway" } as const;
    expect(writeStatus(h.db, lease, { state: "failed", stage: "transport", error }, h.timing)).toBe(
      true,
    );
    expect(h.row("a")).toMatchObject({ state: "failed", lease_owner: null, lease_until: null });
    expect(Number(h.row("a").lease_token)).toBe(lease.token + 1);
    expect(readSnapshot(h.db, "a")?.snapshot.error).toEqual(error);
    expect(
      writeStatus(h.db, { ...lease, token: lease.token + 1 }, { state: "printing" }, h.timing),
    ).toBe(false);
    expect(states()).toEqual(["queued", "failed"]);
  });

  test("tailing from a snapshot's cursor yields each later event exactly once, in order", () => {
    const lease = claimed();
    writeStatus(h.db, lease, { state: "slicing" }, h.timing);
    const { cursor } = readSnapshot(h.db, "a") ?? { cursor: -1 };
    writeStatus(h.db, lease, { state: "transferring" }, h.timing);
    writeStatus(h.db, lease, { state: "printing", progress: 0.1 }, h.timing);
    const tailed = tailEvents(h.db, "a", cursor);
    expect(tailed.map((e) => e.event.state)).toEqual(["transferring", "printing"]);
    expect(tailed[0]?.seq).toBeGreaterThan(cursor);
    expect(tailEvents(h.db, "a", tailed[1]?.seq ?? 0)).toEqual([]);
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
    expect(events.map((e) => e.state)).toEqual(["queued", "queued", "queued", "failed"]);
    expect(events.at(-1)?.error?.reason).toContain("before it reached the printer");
  });

  test("prunes only the events of jobs settled longer ago than the retention", () => {
    const lease = claimed();
    writeStatus(h.db, lease, { state: "done" }, h.timing);
    h.enqueue("b", "p2");
    h.advance(EVENT_RETENTION_MS);
    expect(pruneEvents(h.db, h.timing)).toBe(0);
    h.advance(1);
    expect(pruneEvents(h.db, h.timing)).toBe(2);
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
});
