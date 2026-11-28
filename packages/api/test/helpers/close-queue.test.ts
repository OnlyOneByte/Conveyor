import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { dropsItsRedisKeys } from "../../../shared/test/helpers/index.ts";
import { connection, redis } from "../../src/queue.js";
import { closeQueue } from "./close-queue.ts";

const URL = "redis://127.0.0.1:6379";

class FakeConnection extends EventEmitter {
  disconnects = 0;
  connects = 0;
  stream?: { writable: boolean };
  constructor(
    public status: string,
    private readonly answer: () => Promise<unknown>,
  ) {
    super();
  }
  connect() {
    this.connects++;
    return this.answer();
  }
  disconnect() {
    this.disconnects++;
    if (this.stream?.writable === false && this.status !== "end")
      setTimeout(() => {
        this.status = "end";
        this.emit("end");
      }, 5);
  }
}

const parts = (connection: FakeConnection) => {
  const obliterated: boolean[] = [];
  const redis = { disconnects: 0, disconnect: () => void redis.disconnects++ };
  return {
    obliterated,
    redis,
    parts: {
      connection,
      redis,
      jobQueue: {
        obliterate: async (opts: { force: boolean }) => void obliterated.push(opts.force),
      },
    },
  };
};

test("a Redis that refuses the reconnect rejects, and both clients still disconnect", async () => {
  const down = new FakeConnection("end", () => Promise.reject(new Error("connect ECONNREFUSED")));
  const queue = parts(down);
  await expect(closeQueue(URL, queue.parts, 50)).rejects.toThrow("connect ECONNREFUSED");
  expect([down.disconnects, queue.redis.disconnects, queue.obliterated]).toEqual([1, 1, []]);
});

test("a connection that never turns ready rejects within the bound, and both clients still disconnect", async () => {
  const stuck = new FakeConnection("connecting", () => new Promise(() => {}));
  const queue = parts(stuck);
  const started = Date.now();
  await expect(closeQueue(URL, queue.parts, 50)).rejects.toThrow("queue not back within 50 ms");
  expect(Date.now() - started).toBeLessThan(2_000);
  expect([stuck.disconnects, queue.redis.disconnects, queue.obliterated]).toEqual([1, 1, []]);
});

test("a ready connection obliterates the queue with force, then disconnects", async () => {
  const ready = new FakeConnection("ready", () => Promise.resolve());
  const queue = parts(ready);
  await closeQueue(URL, queue.parts, 50);
  expect([ready.disconnects, queue.redis.disconnects, queue.obliterated]).toEqual([1, 1, [true]]);
});

test("a connection still ready on a closed stream is let end, then reconnected, before it obliterates", async () => {
  const closed = new FakeConnection("ready", async () => {
    closed.status = "ready";
    closed.stream = { writable: true };
  });
  closed.stream = { writable: false };
  const queue = parts(closed);
  await closeQueue(URL, queue.parts, 500);
  expect([closed.connects, closed.disconnects, queue.obliterated]).toEqual([1, 2, [true]]);
});

test("a closed stream that never ends rejects within the bound, and both clients still disconnect", async () => {
  const stuck = new FakeConnection("ready", () => Promise.reject(new Error("must not connect")));
  stuck.stream = { writable: false };
  stuck.disconnect = () => void stuck.disconnects++;
  const queue = parts(stuck);
  await expect(closeQueue(URL, queue.parts, 50)).rejects.toThrow(
    "queue connection didn't end within 50 ms",
  );
  expect([stuck.connects, stuck.disconnects, queue.redis.disconnects, queue.obliterated]).toEqual([
    0,
    2,
    1,
    [],
  ]);
});

test.skipIf(!process.env.REDIS_URL)(
  "two teardowns back to back on the real queue both obliterate, as when queue-errors.test.ts follows jobs-queue-deadline.test.ts",
  async () => {
    connection.disconnect();
    redis.disconnect();
    await closeQueue(process.env.REDIS_URL);
    await closeQueue(process.env.REDIS_URL);
  },
  15_000,
);

test("with no REDIS_URL it only disconnects", async () => {
  const ready = new FakeConnection("end", () => Promise.reject(new Error("must not connect")));
  const queue = parts(ready);
  await closeQueue(undefined, queue.parts, 50);
  expect([ready.disconnects, queue.redis.disconnects, queue.obliterated]).toEqual([1, 1, []]);
});

dropsItsRedisKeys();
