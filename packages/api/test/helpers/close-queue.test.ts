import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { closeQueue } from "./close-queue.ts";

const URL = "redis://127.0.0.1:6379";

class FakeConnection extends EventEmitter {
  disconnects = 0;
  constructor(
    public status: string,
    private readonly answer: () => Promise<unknown>,
  ) {
    super();
  }
  connect() {
    return this.answer();
  }
  disconnect() {
    this.disconnects++;
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
  await expect(closeQueue(queue.parts, 50, URL)).rejects.toThrow("connect ECONNREFUSED");
  expect([down.disconnects, queue.redis.disconnects, queue.obliterated]).toEqual([1, 1, []]);
});

test("a connection that never turns ready rejects within the bound, and both clients still disconnect", async () => {
  const stuck = new FakeConnection("connecting", () => new Promise(() => {}));
  const queue = parts(stuck);
  const started = Date.now();
  await expect(closeQueue(queue.parts, 50, URL)).rejects.toThrow("queue not back within 50 ms");
  expect(Date.now() - started).toBeLessThan(2_000);
  expect([stuck.disconnects, queue.redis.disconnects, queue.obliterated]).toEqual([1, 1, []]);
});

test("a ready connection obliterates the queue with force, then disconnects", async () => {
  const ready = new FakeConnection("ready", () => Promise.resolve());
  const queue = parts(ready);
  await closeQueue(queue.parts, 50, URL);
  expect([ready.disconnects, queue.redis.disconnects, queue.obliterated]).toEqual([1, 1, [true]]);
});

test("with no REDIS_URL it only disconnects", async () => {
  const ready = new FakeConnection("end", () => Promise.reject(new Error("must not connect")));
  const queue = parts(ready);
  await closeQueue(queue.parts, 50, undefined);
  expect([ready.disconnects, queue.redis.disconnects, queue.obliterated]).toEqual([1, 1, []]);
});
