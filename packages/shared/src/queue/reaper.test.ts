import { afterEach, describe, expect, test } from "bun:test";
import { holdWriteLock, type QueueHarness, queueHarness } from "../../test/helpers/queue.ts";
import { claimJob, DEFAULT_TIMING, type Lease, releaseLease, renewLease } from "./lease.ts";
import { reapExpired } from "./reaper.ts";

let h: QueueHarness;
afterEach(() => h.close());

function claimed(state = "state = 'slicing'"): Lease {
  h = queueHarness();
  h.enqueue("a");
  const lease = claimJob(h.db, "w1", h.timing)?.lease;
  if (!lease) throw new Error("not claimed");
  h.set("a", state);
  return lease;
}

describe("reapExpired", () => {
  test("leaves a live lease alone", () => {
    claimed();
    h.advance(30_000);
    expect(reapExpired(h.db, h.timing)).toEqual([]);
  });

  test("requeues an expired unsubmitted job with 5 s then 10 s backoff, then fails it", () => {
    claimed();
    for (const backoff of [5_000, 10_000]) {
      h.advance(30_001);
      expect(reapExpired(h.db, h.timing)).toEqual([{ jobId: "a", outcome: "requeued" }]);
      expect(h.row("a")).toMatchObject({ state: "queued", lease_owner: null, lease_until: null });
      expect(h.row("a").run_after).toBe(h.timing.now() + backoff);
      h.advance(backoff);
      expect(claimJob(h.db, "w1", h.timing)?.lease.jobId).toBe("a");
    }
    h.advance(30_001);
    expect(reapExpired(h.db, h.timing)).toEqual([{ jobId: "a", outcome: "failed" }]);
    expect(JSON.parse(String(h.row("a").error_json))).toEqual({
      stage: "generator",
      reason: "worker lost the job 3 times before it reached the printer",
    });
  });

  test("fails a job whose submit outcome is unknown and never requeues it", () => {
    claimed("state = 'transferring', submit_started_at = 1");
    h.advance(30_001);
    expect(reapExpired(h.db, h.timing)).toEqual([{ jobId: "a", outcome: "unknown" }]);
    expect(h.row("a").state).toBe("failed");
    expect(JSON.parse(String(h.row("a").error_json)).reason).toContain("check the printer");
  });

  test("turns an expired submitted job into an orphan the next claim resumes", () => {
    claimed("state = 'printing', submitted_at = 1");
    h.advance(30_001);
    expect(reapExpired(h.db, h.timing)).toEqual([{ jobId: "a", outcome: "orphaned" }]);
    expect(reapExpired(h.db, h.timing)).toEqual([]);
    expect(claimJob(h.db, "w2", h.timing)).toMatchObject({ resumed: true, state: "printing" });
  });

  test("fences the old owner out of every write after a takeover", () => {
    const lease = claimed();
    h.advance(30_001);
    reapExpired(h.db, h.timing);
    h.advance(-30_001);
    expect(renewLease(h.db, lease, h.timing)).toBeNull();
    expect(releaseLease(h.db, lease, h.timing)).toBe("lost");
    expect(h.row("a")).toMatchObject({ state: "queued", lease_owner: null });
  });

  test("takes an in-flight row with no lease and no submit marker", () => {
    claimed("state = 'slicing', lease_owner = NULL, lease_until = NULL");
    expect(reapExpired(h.db, h.timing)).toEqual([{ jobId: "a", outcome: "requeued" }]);
  });

  test("takes a lease more than one lease length ahead, as after a backward clock step", () => {
    claimed();
    h.set("a", `lease_until = ${h.timing.now() + 30_000}`);
    expect(reapExpired(h.db, h.timing)).toEqual([]);
    h.set("a", `lease_until = ${h.timing.now() + 60_000}`);
    expect(reapExpired(h.db, h.timing)).toEqual([{ jobId: "a", outcome: "requeued" }]);
  });

  test("does not take over a lease another process renews while the reaper waits on the lock", async () => {
    claimed();
    const realClock = { ...DEFAULT_TIMING, now: Date.now };
    h.set("a", `lease_until = ${Date.now() + 30_000}`);
    const renewer = await holdWriteLock(
      h.path,
      "UPDATE jobs SET lease_until = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) + 30000 WHERE id = 'a'",
    );
    expect(reapExpired(h.db, realClock)).toEqual([]);
    expect(await renewer.exited).toBe(0);
    expect(h.row("a").lease_owner).toBe("w1");
  });
});
