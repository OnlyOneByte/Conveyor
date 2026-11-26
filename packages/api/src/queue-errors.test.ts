import { afterAll, expect, test } from "bun:test";
import { JOB_REMOVAL } from "@conveyor/shared";
import { closeQueue } from "../test/helpers/close-queue.ts";
import { connection, jobQueue, redis } from "./queue.js";

connection.disconnect();
redis.disconnect();

test("the api's Redis clients and job queue listen for errors, so a dropped Redis is logged, not unhandled", () => {
  for (const source of [connection, redis, jobQueue]) {
    expect(source.listenerCount("error")).toBeGreaterThan(0);
  }
});

test("finished and failed BullMQ jobs are removed after a week, with no count cap", () => {
  expect(jobQueue.defaultJobOptions.removeOnComplete).toEqual({ age: 7 * 24 * 60 * 60 });
  expect(jobQueue.defaultJobOptions.removeOnFail).toEqual({ age: 7 * 24 * 60 * 60 });
  expect(JOB_REMOVAL).not.toHaveProperty("count");
});

afterAll(() => closeQueue(process.env.REDIS_URL));
