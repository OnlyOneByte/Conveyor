import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { ACTIVE_JOBS_KEY, type JobRequest, publishStatus } from "@conveyor/shared";
import { dbGetJob, dbListNeedsYou } from "@conveyor/shared/db";
import { Worker } from "bullmq";
import { reaperUrl, request, useReaperHarness } from "../test/helpers/reaper-harness.js";
import { ORPHAN_REASON, WORKER_OPTIONS } from "./redis-reaper.js";

describe.skipIf(!reaperUrl)("the Redis reaper with live workers", () => {
  const harness = useReaperHarness();

  test("a worker killed mid-print isn't run again, and is recorded failed with what to check", async () => {
    const t = harness();
    const id = t.track(randomUUID());
    const options = { ...WORKER_OPTIONS, lockDuration: 400, stalledInterval: 200 };
    let started = false;
    const doomed = new Worker<JobRequest>(
      t.queueName,
      async (job) => {
        await publishStatus(t.redis, {
          jobId: job.id ?? "",
          state: "printing",
          stage: "transport",
          at: Date.now(),
        });
        started = true;
        await new Promise(() => {});
      },
      { ...options, connection: t.connect() },
    );
    await t.queue.add("job", request, { jobId: id });
    while (!started) await Bun.sleep(20);
    await doomed.close(true);
    let reran = false;
    const checker = new Worker<JobRequest>(
      t.queueName,
      async () => {
        reran = true;
      },
      { ...options, connection: t.connect() },
    );
    try {
      await t.stateOf(id, "failed");
      await t.reaper.sweep();
    } finally {
      await checker.close();
    }
    expect(reran).toBe(false);
    expect(dbGetJob(t.db, id)).toMatchObject({
      state: "failed",
      stage: "transport",
      error: { stage: "transport", reason: ORPHAN_REASON },
      request,
    });
    expect(ORPHAN_REASON).toContain("check the printer before you retry");
    expect(await t.snapshotOf(id)).toMatchObject({ state: "failed", stage: "transport" });
    expect(await t.redis.sismember(ACTIVE_JOBS_KEY, id)).toBe(0);
    expect(dbListNeedsYou(t.db).map((job) => job.id)).toContain(id);
  }, 20_000);

  test("a job a live worker holds active is left alone", async () => {
    const t = harness();
    const id = t.track(randomUUID());
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    let started = false;
    const worker = new Worker<JobRequest>(
      t.queueName,
      async (job) => {
        await publishStatus(t.redis, {
          jobId: job.id ?? "",
          state: "slicing",
          stage: "slicer",
          at: Date.now(),
        });
        started = true;
        await held;
      },
      { ...WORKER_OPTIONS, connection: t.connect() },
    );
    try {
      await t.queue.add("job", request, { jobId: id });
      while (!started) await Bun.sleep(20);
      await t.stateOf(id, "active");
      for (let i = 0; i < 3; i++) await t.reaper.sweep();
      expect(dbGetJob(t.db, id)).toBeNull();
      expect(await t.snapshotOf(id)).toMatchObject({ state: "slicing", stage: "slicer" });
      expect(await t.redis.sismember(ACTIVE_JOBS_KEY, id)).toBe(1);
    } finally {
      release();
      await worker.close();
    }
  }, 20_000);
});
