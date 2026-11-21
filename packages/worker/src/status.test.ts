import { afterAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  ACTIVE_JOBS_KEY,
  type JobState,
  jobSnapshotKey,
  parseStatusEvent,
  publishStatus,
  TERMINAL_STATES,
} from "@conveyor/shared";
import { Redis } from "ioredis";

const url = process.env.REDIS_URL;
if (!url && process.env.CI) throw new Error("REDIS_URL must be set in CI for the Lua guard tests");

const redis = url ? new Redis(url, { lazyConnect: true }) : undefined;
const touched: string[] = [];

afterAll(async () => {
  if (!redis) return;
  if (touched.length) await redis.del(...touched.map(jobSnapshotKey));
  if (touched.length) await redis.srem(ACTIVE_JOBS_KEY, ...touched);
  redis.disconnect();
});

function client(): Redis {
  if (!redis) throw new Error("no redis");
  return redis;
}

function newJob(): string {
  const id = `test-${randomUUID()}`;
  touched.push(id);
  return id;
}

const write = (jobId: string, state: JobState) =>
  publishStatus(client(), { jobId, state, at: Date.now() });

const snapshotState = async (jobId: string) =>
  parseStatusEvent(await client().get(jobSnapshotKey(jobId)))?.state;

describe.skipIf(!redis)("publishStatus Lua guard (real Redis)", () => {
  test("a live state is written and the job joins jobs:active", async () => {
    const id = newJob();
    expect(await write(id, "printing")).toBe(true);
    expect(await snapshotState(id)).toBe("printing");
    expect(await client().sismember(ACTIVE_JOBS_KEY, id)).toBe(1);
  });

  test.each([...TERMINAL_STATES])("nothing replaces a %s snapshot", async (terminal) => {
    const id = newJob();
    await write(id, "printing");
    expect(await write(id, terminal)).toBe(true);
    expect(await client().sismember(ACTIVE_JOBS_KEY, id)).toBe(0);
    for (const later of ["printing", "done", "failed", "canceled"] as const) {
      expect(await write(id, later)).toBe(false);
    }
    expect(await snapshotState(id)).toBe(terminal);
    expect(await client().sismember(ACTIVE_JOBS_KEY, id)).toBe(0);
  });

  test("exactly one of many concurrent terminal writes wins", async () => {
    const id = newJob();
    await write(id, "printing");
    const states = Array.from({ length: 30 }, (_, i): JobState => (i % 2 ? "done" : "canceled"));
    const results = await Promise.all(states.map((s) => write(id, s)));
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});

describe("parseStatusEvent", () => {
  test("accepts a well-formed event", () => {
    const evt = parseStatusEvent(JSON.stringify({ jobId: "j", state: "done", at: 1 }));
    expect(evt?.state).toBe("done");
  });

  test.each([
    ["not json", "{"],
    ["an unknown state", JSON.stringify({ jobId: "j", state: "exploded", at: 1 })],
    ["a missing jobId", JSON.stringify({ state: "done", at: 1 })],
    ["null", null],
  ])("rejects %s", (_label, raw) => {
    expect(parseStatusEvent(raw)).toBeUndefined();
  });
});
