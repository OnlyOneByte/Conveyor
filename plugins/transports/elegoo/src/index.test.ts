import { afterEach, describe, expect, test } from "bun:test";
import type { PrintHandle } from "@conveyor/shared";
import { elegoo } from "./index";
import { SDCP_CMD } from "./sdcp";

const RealWebSocket = globalThis.WebSocket;

afterEach(() => {
  Reflect.set(globalThis, "WebSocket", RealWebSocket);
});

type Mode = "ack" | "close" | "silent";

class FakeWebSocket {
  static mode: Mode = "ack";
  static sent: { url: string; frame: { Data: { Cmd: number; MainboardID: string } } }[] = [];
  static closed = 0;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {
    queueMicrotask(() => this.onopen?.());
  }
  send(raw: string) {
    const frame = JSON.parse(raw);
    FakeWebSocket.sent.push({ url: this.url, frame });
    if (FakeWebSocket.mode === "close") queueMicrotask(() => this.onclose?.());
    if (FakeWebSocket.mode !== "ack") return;
    const ack = { Data: { RequestID: frame.Data.RequestID, Data: { Ack: 0 } } };
    queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(ack) }));
  }
  close() {
    FakeWebSocket.closed++;
  }
}

function useFakeSocket(mode: Mode) {
  FakeWebSocket.mode = mode;
  FakeWebSocket.sent = [];
  FakeWebSocket.closed = 0;
  Reflect.set(globalThis, "WebSocket", FakeWebSocket);
}

const handle: PrintHandle = {
  transportId: "elegoo",
  printerId: "conveyor-printer-1",
  ref: "a.gcode",
  address: "10.0.0.8",
  deviceId: "mainboard-abc",
};

function withinMs<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${what} did not finish in ${ms} ms`)), ms),
    ),
  ]);
}

describe("elegoo cancel", () => {
  test("sends STOP_PRINT to the mainboard the print was started on", async () => {
    useFakeSocket("ack");
    await elegoo.cancel?.(handle);
    expect(FakeWebSocket.sent).toHaveLength(1);
    const { url, frame } = FakeWebSocket.sent[0];
    expect(url).toBe("ws://10.0.0.8:3030/websocket");
    expect(frame.Data.Cmd).toBe(SDCP_CMD.STOP_PRINT);
    expect(frame.Data.MainboardID).toBe("mainboard-abc");
  });

  test("a socket that closes without an ack is not a confirmed stop", async () => {
    useFakeSocket("close");
    const stop = elegoo.cancel?.(handle) ?? Promise.resolve();
    await expect(stop).rejects.toThrow("closed before the printer acked");
  });
});

describe("elegoo handles", () => {
  test("handleFor carries the stored mainboard id", () => {
    const built = elegoo.handleFor?.(
      {
        id: "conveyor-printer-1",
        transportId: "elegoo",
        address: "10.0.0.8",
        secrets: { mainboardId: "mainboard-abc" },
      },
      "a.gcode",
    );
    expect(built?.deviceId).toBe("mainboard-abc");
    expect(built?.address).toBe("10.0.0.8");
  });
});

describe("elegoo status", () => {
  test("the status stream ends when the signal aborts", async () => {
    useFakeSocket("silent");
    const controller = new AbortController();
    const seen: string[] = [];
    const drain = (async () => {
      for await (const s of elegoo.status(handle, controller.signal)) {
        seen.push(s.state);
        setTimeout(() => controller.abort(), 5);
      }
    })();
    await withinMs(drain, 1000, "elegoo status");
    expect(seen).toEqual(["transferring"]);
    expect(FakeWebSocket.closed).toBe(1);
  });
});
