import { afterEach, describe, expect, test } from "bun:test";
import { type QueueHarness, queueHarness } from "../../test/helpers/queue.ts";
import { dbUpsertPrinter } from "../db/index.ts";
import type { StageTiming } from "../job.ts";
import { claimJob, type Lease, releaseLease } from "./lease.ts";
import { failResume, RESUME_FAILED_REASON, readResumeState } from "./resume.ts";
import { tailEvents } from "./status.ts";
import { markSubmitted, takePrinterSlot } from "./submit.ts";

let h: QueueHarness;
afterEach(() => h.close());

const handle = { transportId: "fake", printerId: "p1", ref: "a.gcode", address: "10.0.0.2" };
const holdOf = () =>
  h.db.query("SELECT hold_job_id, hold_reason FROM printers WHERE id = 'p1'").get();

function claim(): Lease {
  const lease = claimJob(h.db, "w1", h.timing)?.lease;
  if (!lease) throw new Error("not claimed");
  return lease;
}

function orphanResumed(): Lease {
  h = queueHarness();
  dbUpsertPrinter(h.db, { id: "p1", transportId: "fake", name: "P1", address: "10.0.0.2" });
  h.enqueue("a");
  const first = claim();
  h.set("a", "state = 'slicing'");
  takePrinterSlot(h.db, first, h.timing);
  markSubmitted(h.db, first, handle, h.timing);
  expect(releaseLease(h.db, first, h.timing)).toBe("orphaned");
  return claim();
}

describe("readResumeState", () => {
  test("returns the stored handle, artifacts and timings to the job's owner only", () => {
    const lease = orphanResumed();
    const timings: StageTiming[] = [
      { stage: "generator", enteredAt: 1, durationMs: 4 },
      { stage: "transport", enteredAt: 5 },
    ];
    h.set(
      "a",
      `model_path = '/data/m.stl', gcode_path = '/data/m.gcode', timings_json = '${JSON.stringify(timings)}'`,
    );
    expect(readResumeState(h.db, lease, h.timing)).toEqual({
      handle,
      modelPath: "/data/m.stl",
      gcodePath: "/data/m.gcode",
      timings,
    });
    expect(readResumeState(h.db, { ...lease, token: lease.token - 1 }, h.timing)).toBeNull();
    h.set("a", `print_handle_json = '{"ref": 1}'`);
    expect(readResumeState(h.db, lease, h.timing)).toBeNull();
  });

  test("returns nothing for a job that has not reached the printer", () => {
    h = queueHarness();
    h.enqueue("a");
    expect(readResumeState(h.db, claim(), h.timing)).toBeNull();
  });
});

describe("failResume", () => {
  test("fails a resumed job and holds its printer in one write", () => {
    const lease = orphanResumed();
    expect(failResume(h.db, lease, h.timing)).toBe(true);
    expect(h.row("a")).toMatchObject({ state: "failed", lease_owner: null, lease_until: null });
    expect(Number(h.row("a").lease_token)).toBe(lease.token + 1);
    expect(JSON.parse(String(h.row("a").error_json))).toEqual({
      stage: "transport",
      reason: RESUME_FAILED_REASON,
    });
    expect(tailEvents(h.db, "a", 0).at(-1)?.event.state).toBe("failed");
    expect(holdOf()).toEqual({ hold_job_id: "a", hold_reason: RESUME_FAILED_REASON });
    h.enqueue("next");
    expect(claimJob(h.db, "w2", h.timing)).toBeNull();
  });

  test("changes nothing for a stale lease or a job that never reached the printer", () => {
    const lease = orphanResumed();
    expect(failResume(h.db, { ...lease, owner: "w2" }, h.timing)).toBe(false);
    expect(failResume(h.db, { ...lease, token: lease.token - 1 }, h.timing)).toBe(false);
    h.advance(30_001);
    expect(failResume(h.db, lease, h.timing)).toBe(false);
    expect(h.row("a")).toMatchObject({ state: "transferring", lease_token: lease.token });
    expect(holdOf()).toEqual({ hold_job_id: null, hold_reason: null });
    h.close();
    h = queueHarness();
    h.enqueue("a");
    expect(failResume(h.db, claim(), h.timing)).toBe(false);
    expect(h.row("a").state).toBe("generating");
  });
});
