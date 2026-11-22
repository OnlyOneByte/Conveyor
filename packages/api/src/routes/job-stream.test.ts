import { afterEach, describe, expect, test } from "bun:test";
import type { JobState } from "@conveyor/shared";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { FakeSubscriber } from "../../test/fake-subscriber.ts";
import { createStatusHub, type StatusHub } from "../status-hub.js";
import { type JobStreamDeps, registerJobStream } from "./job-stream.js";

const channel = "job:j1:status";
const frame = (state: JobState, at: number) => JSON.stringify({ jobId: "j1", state, at });
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

async function serve(hub: StatusHub, deps: Partial<JobStreamDeps>) {
  app = Fastify();
  await app.register(websocket);
  registerJobStream(app, { hub, snapshot: async () => null, queued: async () => true, ...deps });
  const base = (await app.listen({ host: "127.0.0.1", port: 0 })).replace("http", "ws");
  const ws = new WebSocket(`${base}/jobs/j1/ws`);
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
    await Bun.sleep(30);
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
    const { hub, publish } = fakeHub();
    const socket = await serve(hub, {});
    await Bun.sleep(30);
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
    await Bun.sleep(30);
    expect(hub.connections()).toBe(1);
    socket.ws.close();
    await socket.closed;
    await Bun.sleep(30);
    expect(hub.connections()).toBe(0);
  });
});
