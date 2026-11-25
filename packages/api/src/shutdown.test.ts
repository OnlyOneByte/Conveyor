import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { JOB_STREAM_CLOSE } from "@conveyor/shared";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { closeOnSignals, closeSocketsRestarting } from "./shutdown";

function exits() {
  const codes: number[] = [];
  let settle = () => {};
  const next = () => new Promise<void>((resolve) => (settle = resolve));
  return {
    codes,
    next,
    exit: (code: number) => {
      codes.push(code);
      settle();
    },
  };
}

describe("closeOnSignals", () => {
  test("closes the app on SIGTERM, then exits 0", async () => {
    const app = Fastify();
    const closed: string[] = [];
    app.addHook("onClose", async () => {
      closed.push("app");
    });
    const source = new EventEmitter();
    const { codes, next, exit } = exits();
    closeOnSignals(app, { source, exit });
    const exited = next();
    source.emit("SIGTERM");
    await exited;
    expect(closed).toEqual(["app"]);
    expect(codes).toEqual([0]);
  });

  test("exits 1 at once on a second signal while still closing", async () => {
    const app = Fastify();
    let release = () => {};
    let entered = () => {};
    const closing = new Promise<void>((resolve) => (entered = resolve));
    app.addHook("onClose", () => {
      entered();
      return new Promise<void>((resolve) => (release = resolve));
    });
    const source = new EventEmitter();
    const { codes, next, exit } = exits();
    closeOnSignals(app, { source, exit });
    source.emit("SIGINT");
    const second = next();
    source.emit("SIGTERM");
    await second;
    expect(codes).toEqual([1]);
    await closing;
    const first = next();
    release();
    await first;
    expect(codes).toEqual([1, 0]);
  });

  test("exits 1 when closing the app fails", async () => {
    const app = Fastify();
    app.addHook("onClose", async () => {
      throw new Error("redis quit failed");
    });
    const source = new EventEmitter();
    const { codes, next, exit } = exits();
    closeOnSignals(app, { source, exit });
    const exited = next();
    source.emit("SIGTERM");
    await exited;
    expect(codes).toEqual([1]);
  });

  test("exits 1 when the app is still closing at the deadline", async () => {
    const app = Fastify();
    app.addHook("onClose", () => new Promise<void>(() => undefined));
    const source = new EventEmitter();
    const { codes, next, exit } = exits();
    closeOnSignals(app, { source, exit, deadlineMs: 20 });
    const exited = next();
    source.emit("SIGTERM");
    await exited;
    expect(codes).toEqual([1]);
  });
});

describe("closeSocketsRestarting", () => {
  test("tells every open socket the server is restarting", async () => {
    const app = Fastify();
    await app.register(websocket, { preClose: closeSocketsRestarting });
    const seen: number[] = [];
    app.get("/ws", { websocket: true }, (socket) => {
      socket.on("close", (code: number) => seen.push(code));
    });
    const base = await app.listen({ host: "127.0.0.1", port: 0 });
    const ws = new WebSocket(`${base.replace("http", "ws")}/ws`);
    await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
    await new Promise<void>((resolve) => closeSocketsRestarting.call(app, resolve));
    for (let i = 0; i < 100 && seen.length === 0; i++) await Bun.sleep(10);
    expect(seen).toEqual([JOB_STREAM_CLOSE.restarting]);
    app.server.closeAllConnections();
    app.server.close();
  });
});
