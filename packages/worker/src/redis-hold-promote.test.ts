import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { DelayedError, Queue } from "bullmq";
import { dropsItsRedisKeys } from "../../shared/test/helpers/index.ts";
import { type HeldJob, type HoldWaitDeps, waitOutHold } from "./hold-wait";

const url = process.env.REDIS_URL;
if (!url && process.env.CI)
  throw new Error("REDIS_URL must be set in CI for the Redis hold-promote test");

let queue: Queue | undefined;

afterEach(async () => {
  await queue?.obliterate({ force: true });
  await queue?.close();
  queue = undefined;
});

const request = { generator: { id: "gridfinity" }, printerId: "garage", profileId: "p" };

describe.skipIf(!url)("releasing held jobs from two workers at once (real Redis)", () => {
  test("a job the other worker already promoted doesn't fail the one that found it", async () => {
    queue = new Queue(`test-hold-promote-${randomUUID()}`, { connection: { url } });
    const older = await queue.add("job", request, {
      jobId: `older-${randomUUID()}`,
      delay: 60_000,
    });
    const seen: HeldJob[] = await queue.getDelayed();
    await (await queue.getJob(older.id ?? ""))?.promote();

    const moved: string[] = [];
    const claimed: HeldJob = {
      id: "claimed",
      timestamp: older.timestamp + 1,
      data: request,
      getState: async () => "active",
      promote: async () => {},
      moveToDelayed: async (_until, token) => {
        moved.push(String(token));
      },
    };
    const deps: HoldWaitDeps = {
      held: () => null,
      canceled: async () => false,
      settleCanceled: async () => {},
      shownAs: async () => undefined,
      showQueued: async () => {},
      delayed: async () => seen,
      printerOf: () => request.printerId,
    };
    await expect(waitOutHold(claimed, "lock", request.printerId, deps)).rejects.toBeInstanceOf(
      DelayedError,
    );
    expect(moved).toEqual(["lock"]);
    expect(await older.getState()).toBe("waiting");
  });
});

dropsItsRedisKeys();
