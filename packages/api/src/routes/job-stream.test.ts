import { afterEach, describe, expect, test } from "bun:test";
import type { JobState } from "@conveyor/shared";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { FakeSubscriber } from "../../test/helpers/fake-subscriber.ts";
import { silentClient } from "../../test/helpers/silent-client.ts";
import { createStatusHub, type StatusHub } from "../status-hub.js";
import { type JobStreamDeps, registerJobStream } from "./job-stream.js";

const jobId = "0b3f6c1e-6a4d-4c3e-9f1a-2d5e7b8c9a01";
const channel = `job:${jobId}:status`;
const frame = (state: JobState, seq: number) => JSON.stringify({ seq, jobId, state, at: seq });
let app: FastifyInstance | undefined;

afterEach(async () => {
  app?.server.closeAllConnections();
  await app?.close();
  app = undefined;
});

function fakeHub() {
  const subscribers: FakeSubscriber[] = [];
  const hub = createStatusHub(
    () => {
      const sub = new FakeSubscriber();
      subscribers.push(sub);
      return sub;
    },
    () => {},
  );
  const publish = (payload: string) => subscribers.at(-1)?.emit(channel, payload);
  return { hub, subscribers, publish };
}

async function until(what: string, ready: () => boolean, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!ready()) {
    if (Date.now() > deadline) throw new Error(`${what} not reached within ${ms} ms`);
    await Bun.sleep(2);
  }
}

const subscribed = (subscribers: FakeSubscriber[]) => () =>
  subscribers.some((sub) => sub.calls.includes(`subscribe ${channel}`));

async function listen(hub: StatusHub, deps: Partial<JobStreamDeps>) {
  app = Fastify();
  await app.register(websocket);
  registerJobStream(app, { hub, snapshot: async () => null, queued: async () => true, ...deps });
  return (await app.listen({ host: "127.0.0.1", port: 0 })).replace("http", "ws");
}

async function serve(hub: StatusHub, deps: Partial<JobStreamDeps>, id = jobId) {
  const base = await listen(hub, deps);
  const ws = new WebSocket(`${base}/jobs/${encodeURIComponent(id)}/ws`);
  const states: string[] = [];
  ws.addEventListener("message", (e) => states.push(JSON.parse(String(e.data)).state));
  const closed = new Promise<number>((resolve) =>
    ws.addEventListener("close", (e) => resolve(e.code), { once: true }),
  );
  await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
  return { ws, states, closed };
}

describe("the job status stream", () => {
  test("keeps an event published between the subscribe and the snapshot read", async () => {
    const { hub, publish } = fakeHub();
    const socket = await serve(hub, {
      snapshot: async () => {
        publish(frame("generating", 1));
        publish(frame("slicing", 2));
        return frame("generating", 1);
      },
    });
    await until("the snapshot and the buffered event", () => socket.states.length === 2);
    publish(frame("done", 3));
    expect(await socket.closed).toBe(1000);
    expect(socket.states).toEqual(["generating", "slicing", "done"]);
  });

  test("keeps a terminal event that lands in that window, and closes on it", async () => {
    const { hub, publish } = fakeHub();
    const socket = await serve(hub, {
      snapshot: async () => {
        const stale = frame("printing", 1);
        publish(frame("done", 2));
        return stale;
      },
    });
    expect(await socket.closed).toBe(1000);
    expect(socket.states).toEqual(["printing", "done"]);
  });

  test("sends the snapshot of a finished job and closes with 1000", async () => {
    const { hub } = fakeHub();
    const socket = await serve(hub, { snapshot: async () => frame("failed", 1) });
    expect(await socket.closed).toBe(1000);
    expect(socket.states).toEqual(["failed"]);
    expect(hub.connections()).toBe(0);
  });

  test("waits for a queued job that has no snapshot yet", async () => {
    const { hub, subscribers, publish } = fakeHub();
    const socket = await serve(hub, {});
    await until("the subscribe", subscribed(subscribers));
    publish(frame("generating", 1));
    publish(frame("canceled", 2));
    expect(await socket.closed).toBe(1000);
    expect(socket.states).toEqual(["generating", "canceled"]);
  });

  test("closes an unknown job with 4404 and no frame", async () => {
    const { hub } = fakeHub();
    const socket = await serve(hub, { queued: async () => false });
    expect(await socket.closed).toBe(4404);
    expect(socket.states).toEqual([]);
    expect(hub.connections()).toBe(0);
  });

  test("closes with 1011 when the subscribe fails", async () => {
    const sub = new FakeSubscriber();
    sub.failSubscribe = true;
    const hub = createStatusHub(
      () => sub,
      () => {},
    );
    const socket = await serve(hub, {});
    expect(await socket.closed).toBe(1011);
    expect(hub.connections()).toBe(0);
  });

  test("releases the shared subscriber when the viewer disconnects", async () => {
    const { hub } = fakeHub();
    const socket = await serve(hub, {});
    await until("the shared subscriber", () => hub.connections() === 1);
    socket.ws.close();
    await socket.closed;
    await until("the subscriber's release", () => hub.connections() === 0);
  });

  test.each(["meta", `${jobId}:cancel`, "j1"])(
    "closes a non-UUID id (%s) with 4404 before any lookup",
    async (id) => {
      const { hub } = fakeHub();
      let lookups = 0;
      const count = async () => {
        lookups++;
        return "1";
      };
      const socket = await serve(hub, { snapshot: count, queued: async () => true }, id);
      expect(await socket.closed).toBe(4404);
      expect([socket.states, lookups, hub.connections()]).toEqual([[], 0, 0]);
    },
  );

  test("keeps a live event between two identical ones", async () => {
    const { hub, publish } = fakeHub();
    const same = { state: "printing", progress: 0.5 };
    const stamp = (seq: number, extra: object) => JSON.stringify({ seq, jobId, at: 1, ...extra });
    const socket = await serve(hub, {
      snapshot: async () => {
        publish(stamp(1, same));
        publish(stamp(2, { state: "printing", progress: 0.6 }));
        publish(stamp(3, same));
        return stamp(1, same);
      },
    });
    await Bun.sleep(30);
    publish(frame("done", 4));
    expect(await socket.closed).toBe(1000);
    expect(socket.states).toEqual(["printing", "printing", "printing", "done"]);
  });

  test("closes with 1011 when events pile up past the buffer before the snapshot", async () => {
    const { hub, publish } = fakeHub();
    const socket = await serve(hub, {
      limits: { buffered: 2, readMs: 1000 },
      snapshot: async () => {
        for (let seq = 1; seq <= 3; seq++) publish(frame("generating", seq));
        return frame("generating", 1);
      },
    });
    expect(await socket.closed).toBe(1011);
    expect(socket.states).toEqual([]);
    expect(hub.connections()).toBe(0);
  });

  test("closes with 1011 when the snapshot read hangs", async () => {
    const { hub } = fakeHub();
    const socket = await serve(hub, {
      limits: { buffered: 8, readMs: 30 },
      snapshot: () => new Promise(() => {}),
    });
    expect(await socket.closed).toBe(1011);
    expect(hub.connections()).toBe(0);
  });

  test("closes with 1011 when the BullMQ lookup hangs", async () => {
    const { hub } = fakeHub();
    const socket = await serve(hub, {
      limits: { buffered: 8, readMs: 30 },
      queued: () => new Promise(() => {}),
    });
    expect(await socket.closed).toBe(1011);
    expect([socket.states, hub.connections()]).toEqual([[], 0]);
  });

  test("an old worker's terminal event without a seq still ends the stream", async () => {
    const { hub, publish } = fakeHub();
    const legacy = (state: JobState) => JSON.stringify({ jobId, state, at: 9 });
    const socket = await serve(hub, {
      snapshot: async () => {
        publish(legacy("printing"));
        publish(legacy("done"));
        return frame("printing", 4);
      },
    });
    expect(await socket.closed).toBe(1000);
    expect(socket.states).toEqual(["printing", "done"]);
  });

  test("a viewer who leaves while the subscribe is in flight releases it", async () => {
    let release = () => {};
    const sub = new FakeSubscriber();
    sub.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const hub = createStatusHub(
      () => sub,
      () => {},
    );
    const socket = await serve(hub, {});
    socket.ws.close();
    await socket.closed;
    await Bun.sleep(20);
    release();
    await Bun.sleep(20);
    expect(hub.connections()).toBe(0);
    expect(sub.calls).toEqual([`subscribe ${channel}`, "quit"]);
  });

  test("terminates a viewer that stops answering pings and releases the subscriber", async () => {
    const { hub } = fakeHub();
    const base = await listen(hub, { heartbeat: { intervalMs: 10, missed: 1 } });
    const silent = await silentClient(base, `/jobs/${jobId}/ws`);
    await silent.closed;
    for (let i = 0; i < 100 && hub.connections() > 0; i++) await Bun.sleep(5);
    expect(hub.connections()).toBe(0);
  });
});
