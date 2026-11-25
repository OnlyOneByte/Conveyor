import { expect, test } from "bun:test";
import { JOB_REMOVAL } from "@conveyor/shared";
import { connection, jobQueue, redis } from "./queue.js";

connection.disconnect();
redis.disconnect();

test("the api's Redis clients and job queue listen for errors, so a dropped Redis is logged, not unhandled", () => {
  for (const source of [connection, redis, jobQueue]) {
    expect(source.listenerCount("error")).toBeGreaterThan(0);
  }
});

test("finished and failed BullMQ jobs are removed after a week or past 1000 of each", () => {
  expect(jobQueue.defaultJobOptions).toMatchObject({
    removeOnComplete: JOB_REMOVAL,
    removeOnFail: JOB_REMOVAL,
  });
  expect(JOB_REMOVAL).toEqual({ age: 7 * 24 * 60 * 60, count: 1000 });
});
