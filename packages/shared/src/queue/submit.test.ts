import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { holdWriteLock, type QueueHarness, queueHarness } from "../../test/helpers/queue.ts";
import { dbUpsertPrinter } from "../db/index.ts";
import { claimJob, type Lease } from "./lease.ts";
import { reapExpired } from "./reaper.ts";
import { tailEvents } from "./status.ts";
import { markSubmitted, takePrinterSlot, withFullSync } from "./submit.ts";

let h: QueueHarness;
afterEach(() => h.close());

const handle = { transportId: "fake", printerId: "p1", ref: "model.gcode" };
const sync = () => h.db.query<{ synchronous: number }, []>("PRAGMA synchronous").get()?.synchronous;

function slicing(id = "a", printerId = "p1"): Lease {
  h.enqueue(id, printerId);
  const lease = claimJob(h.db, "w1", h.timing)?.lease;
  if (lease?.jobId !== id) throw new Error(`${id} not claimed`);
  h.set(id, "state = 'slicing'");
  return lease;
}

describe("withFullSync", () => {
  test("runs its step at synchronous FULL and puts NORMAL back, even when the step throws", () => {
    h = queueHarness();
    expect(withFullSync(h.db, sync)).toBe(2);
    expect(sync()).toBe(1);
    expect(() =>
      withFullSync(h.db, () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(sync()).toBe(1);
  });
});

describe("takePrinterSlot", () => {
  test("moves a sliced job onto its printer and records the submit intent at FULL", () => {
    h = queueHarness();
    const lease = slicing();
    const exec = spyOn(h.db, "exec");
    const transaction = spyOn(h.db, "transaction");
    expect(takePrinterSlot(h.db, lease, h.timing)).toBe("taken");
    const pragmas = exec.mock.calls.map(([sql]) => sql);
    expect(pragmas).toEqual(["PRAGMA synchronous = FULL;", "PRAGMA synchronous = NORMAL;"]);
    expect(transaction.mock.invocationCallOrder[0] ?? 0).toBeGreaterThan(
      exec.mock.invocationCallOrder[0] ?? 0,
    );
    expect(transaction.mock.invocationCallOrder[0] ?? 0).toBeLessThan(
      exec.mock.invocationCallOrder[1] ?? 0,
    );
    expect(h.row("a")).toMatchObject({ state: "transferring", submit_started_at: h.timing.now() });
    expect(tailEvents(h.db, "a", 0).at(-1)?.event.state).toBe("transferring");
  });

  test("leaves the job waiting while its printer is busy or held", () => {
    h = queueHarness();
    h.enqueue("first");
    claimJob(h.db, "w1", h.timing);
    h.set("first", "state = 'printing'");
    const lease = slicing("a");
    expect(takePrinterSlot(h.db, lease, h.timing)).toBe("busy");
    h.set("first", "state = 'done'");
    dbUpsertPrinter(h.db, { id: "p1", transportId: "fake", name: "P1", address: "10.0.0.2" });
    h.db.exec("UPDATE printers SET hold_job_id = 'old' WHERE id = 'p1'");
    expect(takePrinterSlot(h.db, lease, h.timing)).toBe("busy");
    expect(h.row("a")).toMatchObject({ state: "slicing", submit_started_at: null });
    h.db.exec("UPDATE printers SET hold_job_id = NULL WHERE id = 'p1'");
    expect(takePrinterSlot(h.db, lease, h.timing)).toBe("taken");
  });

  test("leaves the job waiting while another job is still uploading to that printer", () => {
    h = queueHarness();
    const first = slicing("first");
    expect(takePrinterSlot(h.db, first, h.timing)).toBe("taken");
    const lease = slicing("a");
    expect(takePrinterSlot(h.db, lease, h.timing)).toBe("busy");
    expect(h.row("a")).toMatchObject({ state: "slicing", submit_started_at: null });
    expect(h.row("first").state).toBe("transferring");
  });

  test("never records a second intent, so a job cannot be submitted twice", () => {
    h = queueHarness();
    const lease = slicing();
    expect(takePrinterSlot(h.db, lease, h.timing)).toBe("taken");
    h.set("a", "state = 'slicing'");
    expect(takePrinterSlot(h.db, lease, h.timing)).toBe("refused");
    expect(h.row("a").submit_started_at).toBe(h.timing.now());
  });

  test("refuses a job that is not sliced, and answers lost for a stale lease", () => {
    h = queueHarness();
    const lease = slicing();
    h.set("a", "state = 'generating'");
    expect(takePrinterSlot(h.db, lease, h.timing)).toBe("refused");
    h.set("a", "state = 'slicing'");
    expect(takePrinterSlot(h.db, { ...lease, token: lease.token - 1 }, h.timing)).toBe("lost");
    h.advance(30_001);
    expect(takePrinterSlot(h.db, lease, h.timing)).toBe("lost");
  });

  test("waits for the write lock before it reads", async () => {
    h = queueHarness();
    const lease = slicing();
    const holder = await holdWriteLock(h.path);
    const calledAt = Date.now();
    expect(takePrinterSlot(h.db, { ...lease, token: lease.token + 9 }, h.timing)).toBe("lost");
    expect(Date.now() - calledAt).toBeGreaterThanOrEqual(200);
    expect(await holder.exited).toBe(0);
  });
});

describe("markSubmitted", () => {
  test("records the marker and handle once, at FULL", () => {
    h = queueHarness();
    const lease = slicing();
    takePrinterSlot(h.db, lease, h.timing);
    const exec = spyOn(h.db, "exec");
    expect(markSubmitted(h.db, lease, handle, h.timing)).toBe(true);
    expect(exec.mock.calls.map(([sql]) => sql)).toEqual([
      "PRAGMA synchronous = FULL;",
      "PRAGMA synchronous = NORMAL;",
    ]);
    expect(JSON.parse(String(h.row("a").print_handle_json))).toEqual(handle);
    expect(h.row("a").submitted_at).toBe(h.timing.now());
    expect(markSubmitted(h.db, lease, handle, h.timing)).toBe(false);
  });

  test("refuses the marker without its own live lease, and leaves it unwritten", () => {
    h = queueHarness();
    const lease = slicing();
    takePrinterSlot(h.db, lease, h.timing);
    expect(markSubmitted(h.db, { ...lease, token: lease.token - 1 }, handle, h.timing)).toBe(false);
    expect(markSubmitted(h.db, { ...lease, owner: "w2" }, handle, h.timing)).toBe(false);
    h.advance(30_001);
    expect(markSubmitted(h.db, lease, handle, h.timing)).toBe(false);
    expect(h.row("a")).toMatchObject({ submitted_at: null, print_handle_json: null });
  });

  test("refuses the marker for a transferring job with no intent, and once the job left transferring", () => {
    h = queueHarness();
    const lease = slicing();
    h.set("a", "state = 'transferring'");
    expect(markSubmitted(h.db, lease, handle, h.timing)).toBe(false);
    h.set("a", "state = 'printing', submit_started_at = 1");
    expect(markSubmitted(h.db, lease, handle, h.timing)).toBe(false);
    expect(h.row("a").submitted_at).toBeNull();
  });
});

describe("never resubmit", () => {
  test("a worker lost after the intent leaves a failed job and a held printer, never a second intent", () => {
    h = queueHarness();
    dbUpsertPrinter(h.db, { id: "p1", transportId: "fake", name: "P1", address: "10.0.0.2" });
    const lease = slicing();
    takePrinterSlot(h.db, lease, h.timing);
    h.advance(30_001);
    expect(reapExpired(h.db, h.timing)).toEqual([{ jobId: "a", outcome: "unknown" }]);
    expect(takePrinterSlot(h.db, lease, h.timing)).toBe("lost");
    expect(h.db.query("SELECT hold_job_id FROM printers WHERE id = 'p1'").get()).toEqual({
      hold_job_id: "a",
    });
  });

  test("a worker lost after the marker is resumed, and the resumed job cannot take the slot again", () => {
    h = queueHarness();
    const lease = slicing();
    takePrinterSlot(h.db, lease, h.timing);
    markSubmitted(h.db, lease, handle, h.timing);
    h.set("a", "state = 'printing'");
    h.advance(30_001);
    expect(reapExpired(h.db, h.timing)).toEqual([{ jobId: "a", outcome: "orphaned" }]);
    const resumed = claimJob(h.db, "w2", h.timing);
    expect(resumed).toMatchObject({ resumed: true, state: "printing" });
    if (!resumed) throw new Error("not resumed");
    h.set("a", "state = 'slicing'");
    expect(takePrinterSlot(h.db, resumed.lease, h.timing)).toBe("refused");
  });
});
