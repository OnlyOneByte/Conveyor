import { describe, expect, test } from "bun:test";
import { DEFAULT_HEARTBEAT, keepAlive, type PingableSocket } from "./heartbeat";
import { DEFAULT_TAIL } from "./routes/jobs-sqlite";

class FakeSocket implements PingableSocket {
  pings = 0;
  terminated = false;
  answer = false;
  private listeners: Record<string, (() => void)[]> = {};
  ping() {
    this.pings++;
    if (this.answer) queueMicrotask(() => this.emit("pong"));
  }
  terminate() {
    this.terminated = true;
    this.emit("close");
  }
  on(event: "pong" | "close", listener: () => void) {
    this.listeners[event] = [...(this.listeners[event] ?? []), listener];
    return this;
  }
  emit(event: string) {
    for (const listener of this.listeners[event] ?? []) listener();
  }
}

async function until(done: () => boolean) {
  for (let i = 0; i < 400 && !done(); i++) await Bun.sleep(5);
  if (!done()) throw new Error("condition not reached");
}

describe("keepAlive", () => {
  test("terminates a socket after the allowed number of unanswered pings, and stops", async () => {
    const socket = new FakeSocket();
    keepAlive(socket, { intervalMs: 5, missed: 2 });
    await until(() => socket.terminated);
    expect(socket.pings).toBe(2);
    await Bun.sleep(30);
    expect(socket.pings).toBe(2);
  });

  test("keeps a socket that answers every ping", async () => {
    const socket = new FakeSocket();
    socket.answer = true;
    keepAlive(socket, { intervalMs: 5, missed: 1 });
    await until(() => socket.pings >= 6);
    expect(socket.terminated).toBe(false);
    socket.emit("close");
    const pings = socket.pings;
    await Bun.sleep(30);
    expect(socket.pings).toBe(pings);
  });

  test("pings every 30 s and drops a socket after 2 missed pongs, on both queues", () => {
    expect(DEFAULT_HEARTBEAT).toEqual({ intervalMs: 30_000, missed: 2 });
    expect(DEFAULT_TAIL.heartbeat).toBe(DEFAULT_HEARTBEAT);
  });
});
