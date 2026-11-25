import { expect, test } from "bun:test";
import { connection, jobQueue, redis } from "./queue.js";

connection.disconnect();
redis.disconnect();

test("the api's Redis clients and job queue listen for errors, so a dropped Redis is logged, not unhandled", () => {
  for (const source of [connection, redis, jobQueue]) {
    expect(source.listenerCount("error")).toBeGreaterThan(0);
  }
});
