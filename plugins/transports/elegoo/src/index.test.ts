import { afterEach, describe, expect, test } from "bun:test";
import { elegoo } from "./index";
import { SDCP_CMD } from "./sdcp";

const RealWebSocket = globalThis.WebSocket;

afterEach(() => {
  globalThis.WebSocket = RealWebSocket;
});

class FakeWebSocket {
  static sent: { url: string; frame: Record<string, unknown> }[] = [];
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
    const requestId = frame?.Data?.RequestID;
    queueMicrotask(() =>
      this.onmessage?.({
        data: JSON.stringify({ Data: { RequestID: requestId, Data: { Ack: 0 } } }),
      }),
    );
  }
  close() {}
}

describe("elegoo cancel", () => {
  test("sends STOP_PRINT to the mainboard the print was started on", async () => {
    FakeWebSocket.sent = [];
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    await elegoo.cancel?.({
      transportId: "elegoo",
      printerId: "conveyor-printer-1",
      ref: "a.gcode",
      address: "10.0.0.8",
      deviceId: "mainboard-abc",
    });
    expect(FakeWebSocket.sent).toHaveLength(1);
    const { url, frame } = FakeWebSocket.sent[0];
    expect(url).toBe("ws://10.0.0.8:3030/websocket");
    const body = frame.Data as { Cmd: number; MainboardID: string };
    expect(body.Cmd).toBe(SDCP_CMD.STOP_PRINT);
    expect(body.MainboardID).toBe("mainboard-abc");
  });
});
