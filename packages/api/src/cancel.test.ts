import { describe, expect, test } from "bun:test";
import type { JobRequest, JobState, JobStatusEvent } from "@conveyor/shared";
import { type CancelableJob, type CancelDeps, cancelJob } from "./cancel";

const data: JobRequest = { generator: { id: "gen" }, printerId: "p1", profileId: "prof" };

function setup(opts: { state?: string; snapshot?: JobState; removeThrows?: boolean }) {
  const calls = { requested: 0, removed: 0, settled: 0 };
  let snapshot: JobStatusEvent | undefined = opts.snapshot
    ? { jobId: "j", state: opts.snapshot, at: 1 }
    : undefined;
  const state = opts.state;
  const job: CancelableJob | undefined = state
    ? {
        data,
        getState: async () => state,
        remove: async () => {
          if (opts.removeThrows) throw new Error("job is locked");
          calls.removed++;
        },
      }
    : undefined;
  const deps: CancelDeps = {
    getJob: async () => job,
    readSnapshot: async () => snapshot,
    requestCancel: async () => {
      calls.requested++;
    },
    settleCanceled: async () => {
      calls.settled++;
      snapshot = { jobId: "j", state: "canceled", at: 2 };
      return true;
    },
  };
  return { calls, deps };
}

describe("cancelJob", () => {
  test.each(["waiting", "delayed", "prioritized"])(
    "removes a %s job and settles it",
    async (state) => {
      const { calls, deps } = setup({ state });
      const res = await cancelJob("j", deps);
      expect(res.code).toBe(200);
      expect(res.body.state).toBe("canceled");
      expect(calls).toEqual({ requested: 1, removed: 1, settled: 1 });
    },
  );

  test("signals an active job through the durable flag", async () => {
    const { calls, deps } = setup({ state: "active", snapshot: "printing" });
    const res = await cancelJob("j", deps);
    expect(res.code).toBe(202);
    expect(res.body.state).toBe("canceling");
    expect(calls).toEqual({ requested: 1, removed: 0, settled: 0 });
  });

  test("a job picked up between lookup and remove falls back to the signal", async () => {
    const { calls, deps } = setup({ state: "waiting", removeThrows: true });
    const res = await cancelJob("j", deps);
    expect(res.code).toBe(202);
    expect(calls).toEqual({ requested: 1, removed: 0, settled: 0 });
  });

  test.each(["done", "failed", "canceled"] as const)(
    "a %s job stays final and cancel is a no-op",
    async (snapshot) => {
      const { calls, deps } = setup({ state: "completed", snapshot });
      const res = await cancelJob("j", deps);
      expect(res.code).toBe(200);
      expect(res.body.state).toBe(snapshot);
      expect(calls).toEqual({ requested: 0, removed: 0, settled: 0 });
    },
  );

  test("cancel twice is idempotent", async () => {
    const { calls, deps } = setup({ state: "waiting" });
    await cancelJob("j", deps);
    const again = await cancelJob("j", deps);
    expect(again.code).toBe(200);
    expect(again.body.state).toBe("canceled");
    expect(calls.settled).toBe(1);
  });

  test("an unknown id is a 404", async () => {
    const { calls, deps } = setup({});
    const res = await cancelJob("nope", deps);
    expect(res.code).toBe(404);
    expect(calls.requested).toBe(0);
  });
});
