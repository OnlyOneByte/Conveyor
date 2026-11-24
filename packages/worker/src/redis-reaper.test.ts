import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { ACTIVE_JOBS_KEY, publishStatus } from "@conveyor/shared";
import {
  dbClaimRetry,
  dbGetJob,
  dbListNeedsYou,
  dbRecordJob,
  dbRetriedBy,
} from "@conveyor/shared/db";
import { reaperUrl, request, useReaperHarness } from "../test/helpers/reaper-harness.js";
import { ORPHAN_REASON, startRedisReaper } from "./redis-reaper.js";

describe.skipIf(!reaperUrl)("the Redis reaper", () => {
  const harness = useReaperHarness();

  test("a running job that is gone from BullMQ is recorded failed, with what is known of it", async () => {
    const t = harness();
    const id = t.track(randomUUID());
    await publishStatus(t.redis, {
      jobId: id,
      state: "printing",
      stage: "transport",
      at: Date.now(),
    });
    await t.reaper.sweep();
    expect(dbGetJob(t.db, id)).toMatchObject({
      state: "failed",
      error: { stage: "transport", reason: ORPHAN_REASON },
      request: { generator: { id: "unknown" }, printerId: "", profileId: "" },
    });
    expect(await t.redis.sismember(ACTIVE_JOBS_KEY, id)).toBe(0);
  });

  test("a job BullMQ still has waiting is left alone", async () => {
    const t = harness();
    const id = t.track(randomUUID());
    await t.queue.add("job", request, { jobId: id });
    await publishStatus(t.redis, { jobId: id, state: "queued", at: Date.now() });
    await t.reaper.sweep();
    expect(dbGetJob(t.db, id)).toBeNull();
    expect(await t.redis.sismember(ACTIVE_JOBS_KEY, id)).toBe(1);
  });

  test("a job that already has a history row is left alone, even if its snapshot never settled", async () => {
    const t = harness();
    const id = t.track(randomUUID());
    dbRecordJob(t.db, {
      id,
      generatorId: "gridfinity",
      printerId: "klipper-garage",
      profileId: "orca/klipper-pla-0.2",
      state: "done",
    });
    await publishStatus(t.redis, {
      jobId: id,
      state: "printing",
      stage: "transport",
      at: Date.now(),
    });
    await t.reaper.sweep();
    expect(dbGetJob(t.db, id)?.state).toBe("done");
    expect(await t.snapshotOf(id)).toMatchObject({ state: "printing" });
  });

  test("a job whose final status is already published is left alone, even with no history row", async () => {
    const t = harness();
    const id = t.track(randomUUID());
    await publishStatus(t.redis, {
      jobId: id,
      state: "printing",
      stage: "transport",
      at: Date.now(),
    });
    await publishStatus(t.redis, { jobId: id, state: "done", stage: "transport", at: Date.now() });
    await t.redis.sadd(ACTIVE_JOBS_KEY, id);
    await t.reaper.sweep();
    expect(dbGetJob(t.db, id)).toBeNull();
    expect(await t.snapshotOf(id)).toMatchObject({ state: "done" });
  });

  test("a retry that dies gives its original failure back to Needs-you", async () => {
    const t = harness();
    const original = randomUUID();
    const retry = t.track(randomUUID());
    dbRecordJob(t.db, {
      id: original,
      generatorId: "gridfinity",
      printerId: "klipper-garage",
      profileId: "orca/klipper-pla-0.2",
      state: "failed",
      error: { stage: "transport", reason: "printer went offline" },
    });
    expect(dbClaimRetry(t.db, original, retry)).toBe(true);
    expect(dbListNeedsYou(t.db).map((job) => job.id)).not.toContain(original);
    await publishStatus(t.redis, {
      jobId: retry,
      state: "slicing",
      stage: "slicer",
      at: Date.now(),
    });
    await t.reaper.sweep();
    expect(dbRetriedBy(t.db, original)).toBeNull();
    expect(dbGetJob(t.db, retry)?.state).toBe("failed");
    const needsYou = dbListNeedsYou(t.db).map((job) => job.id);
    expect(needsYou).toContain(original);
    expect(needsYou).not.toContain(retry);
  });

  test("a retry claim whose retry was never queued is released on the second sweep, and a queued one is kept", async () => {
    const t = harness();
    const [lost, kept] = [randomUUID(), randomUUID()];
    const [lostRetry, keptRetry] = [randomUUID(), randomUUID()];
    for (const id of [lost, kept])
      dbRecordJob(t.db, {
        id,
        generatorId: "gridfinity",
        printerId: "klipper-garage",
        profileId: "orca/klipper-pla-0.2",
        state: "failed",
        error: { stage: "slicer", reason: "boom" },
      });
    dbClaimRetry(t.db, lost, lostRetry);
    dbClaimRetry(t.db, kept, keptRetry);
    await t.queue.add("job", request, { jobId: keptRetry });
    await t.reaper.sweep();
    expect(dbRetriedBy(t.db, lost)).toBe(lostRetry);
    await t.reaper.sweep();
    expect(dbRetriedBy(t.db, lost)).toBeNull();
    expect(dbRetriedBy(t.db, kept)).toBe(keptRetry);
  });

  test("starting the reaper sweeps at once, and a failing sweep is logged, not thrown", async () => {
    const t = harness();
    const id = t.track(randomUUID());
    await publishStatus(t.redis, { jobId: id, state: "queued", at: Date.now() });
    const logged: string[] = [];
    const stop = startRedisReaper({ ...t.deps(), log: (message) => logged.push(message) });
    try {
      for (let i = 0; i < 200 && logged.length === 0; i++) await Bun.sleep(25);
      expect(dbGetJob(t.db, id)?.state).toBe("failed");
      expect(logged).toEqual([`recorded job ${id} as failed: BullMQ no longer has it`]);
    } finally {
      stop();
    }
    const broken = startRedisReaper({
      ...t.deps(),
      activeIds: () => Promise.reject(new Error("redis is down")),
      log: (message) => logged.push(message),
    });
    try {
      for (let i = 0; i < 200 && logged.length < 2; i++) await Bun.sleep(25);
      expect(logged[1]).toBe("sweep failed: Error: redis is down");
    } finally {
      broken();
    }
  });
});
