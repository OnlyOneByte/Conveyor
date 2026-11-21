import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { holdWriteLock, type QueueHarness, queueHarness } from "../../test/helpers/queue.ts";
import { claimJob, DEFAULT_TIMING, releaseLease, renewLease } from "./lease.ts";

let h: QueueHarness;
afterEach(() => h.close());

describe("claimJob", () => {
  test("claims queued jobs oldest first, breaking a created_at tie by insertion order", () => {
    h = queueHarness();
    h.enqueue("a", "p1");
    h.enqueue("b", "p2");
    expect(claimJob(h.db, "w1", h.timing)?.lease.jobId).toBe("a");
    expect(claimJob(h.db, "w1", h.timing)?.lease.jobId).toBe("b");
    expect(claimJob(h.db, "w1", h.timing)).toBeNull();
  });

  test("skips jobs not yet due and jobs with a cancel request", () => {
    h = queueHarness();
    h.enqueue("later");
    h.set("later", `run_after = ${h.timing.now() + 1}`);
    h.enqueue("canceled", "p2");
    h.set("canceled", "cancel_requested_at = 1");
    expect(claimJob(h.db, "w1", h.timing)).toBeNull();
  });

  test("lets one job prepare ahead per printer while another is on it", () => {
    h = queueHarness();
    h.enqueue("first");
    h.enqueue("second");
    h.enqueue("third");
    expect(claimJob(h.db, "w1", h.timing)?.lease.jobId).toBe("first");
    expect(claimJob(h.db, "w1", h.timing)).toBeNull();
    h.set("first", "state = 'printing'");
    expect(claimJob(h.db, "w1", h.timing)?.lease.jobId).toBe("second");
    expect(claimJob(h.db, "w1", h.timing)).toBeNull();
  });

  test("resumes a submitted orphan first, keeping its state and attempt count", () => {
    h = queueHarness();
    h.enqueue("queued", "p2");
    h.enqueue("orphan");
    h.set("orphan", "state = 'printing', submitted_at = 1, attempts = 1, lease_token = 4");
    const claimed = claimJob(h.db, "w1", h.timing);
    expect(claimed).toMatchObject({ state: "printing", attempts: 1, resumed: true });
    expect(claimed?.lease).toMatchObject({ jobId: "orphan", token: 5 });
    expect(claimed?.request).toEqual({
      generator: { id: "gen", params: undefined },
      printerId: "p1",
      profileId: "prof",
    });
  });

  test("two connections claiming in turn never take the same job", () => {
    h = queueHarness();
    for (let i = 0; i < 20; i++) h.enqueue(`j${i}`, `p${i}`);
    const other = new Database(h.path);
    const seen = new Set<string>();
    for (let i = 0; i < 10; i++) {
      for (const db of [h.db, other]) seen.add(claimJob(db, "w", h.timing)?.lease.jobId ?? "none");
    }
    other.close();
    expect(seen.size).toBe(20);
    expect(seen.has("none")).toBe(false);
  });
});

describe("renewLease", () => {
  test("extends a live lease from the current clock", () => {
    h = queueHarness();
    h.enqueue("a");
    const lease = claimJob(h.db, "w1", h.timing)?.lease;
    if (!lease) throw new Error("not claimed");
    h.advance(10_000);
    expect(renewLease(h.db, lease, h.timing)?.until).toBe(h.timing.now() + 30_000);
    expect(h.row("a").lease_until).toBe(h.timing.now() + 30_000);
  });

  test("refuses a stale token, another owner, a settled job, and a lease past its own expiry", () => {
    h = queueHarness();
    h.enqueue("a");
    const lease = claimJob(h.db, "w1", h.timing)?.lease;
    if (!lease) throw new Error("not claimed");
    expect(renewLease(h.db, { ...lease, token: lease.token - 1 }, h.timing)).toBeNull();
    expect(renewLease(h.db, { ...lease, owner: "w2" }, h.timing)).toBeNull();
    h.set("a", "state = 'done'");
    expect(renewLease(h.db, lease, h.timing)).toBeNull();
    h.set("a", "state = 'generating'");
    h.advance(30_001);
    expect(renewLease(h.db, lease, h.timing)).toBeNull();
    expect(h.row("a").lease_until).toBe(lease.until);
  });

  test("reads the clock only once it holds the write lock", async () => {
    h = queueHarness();
    h.enqueue("a");
    const realClock = { ...DEFAULT_TIMING, now: Date.now };
    const lease = claimJob(h.db, "w1", realClock)?.lease;
    if (!lease) throw new Error("not claimed");
    const holder = await holdWriteLock(h.path);
    const calledAt = Date.now();
    const renewed = renewLease(h.db, lease, realClock);
    expect(await holder.exited).toBe(0);
    expect((renewed?.until ?? 0) - realClock.leaseMs).toBeGreaterThanOrEqual(calledAt + 200);
  });
});

describe("releaseLease", () => {
  const claimed = (state: string) => {
    h = queueHarness();
    h.enqueue("a");
    const lease = claimJob(h.db, "w1", h.timing)?.lease;
    if (!lease) throw new Error("not claimed");
    h.set("a", state);
    return lease;
  };

  test("requeues an unsubmitted job at once without counting the attempt", () => {
    const lease = claimed("state = 'slicing'");
    expect(releaseLease(h.db, lease, h.timing)).toBe("requeued");
    expect(h.row("a")).toMatchObject({ state: "queued", attempts: 0, lease_owner: null });
    expect(h.row("a").lease_token).toBe(lease.token + 1);
    expect(h.row("a").run_after).toBe(h.timing.now());
  });

  test("leaves a submitted job as a resumable orphan", () => {
    const lease = claimed("state = 'printing', submitted_at = 1");
    expect(releaseLease(h.db, lease, h.timing)).toBe("orphaned");
    expect(h.row("a")).toMatchObject({ state: "printing", lease_owner: null, lease_until: null });
    expect(claimJob(h.db, "w2", h.timing)?.resumed).toBe(true);
  });

  test("refuses while a submit is in progress and once the lease is gone", () => {
    const lease = claimed("state = 'transferring', submit_started_at = 1");
    expect(releaseLease(h.db, lease, h.timing)).toBe("submitting");
    expect(h.row("a").lease_owner).toBe("w1");
    expect(releaseLease(h.db, { ...lease, token: lease.token + 1 }, h.timing)).toBe("lost");
  });
});
