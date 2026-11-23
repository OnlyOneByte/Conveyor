export type Mode = "ack" | "nack" | "close" | "silent" | "garbage" | "chatter";

export class FakeWebSocket {
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
    if (FakeWebSocket.mode === "garbage")
      queueMicrotask(() => this.onmessage?.({ data: "<html>busy</html>" }));
    if (FakeWebSocket.mode === "chatter")
      queueMicrotask(() =>
        this.onmessage?.({ data: JSON.stringify({ Topic: "sdcp/status/x", Data: {} }) }),
      );
    if (FakeWebSocket.mode === "garbage" || FakeWebSocket.mode === "close") return;
    if (FakeWebSocket.mode === "silent") return;
    const code = FakeWebSocket.mode === "nack" ? 1 : 0;
    const ack = { Data: { RequestID: frame.Data.RequestID, Data: { Ack: code } } };
    queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(ack) }));
  }
  close() {
    FakeWebSocket.closed++;
  }
}

export function useFakeSocket(mode: Mode) {
  FakeWebSocket.mode = mode;
  FakeWebSocket.sent = [];
  FakeWebSocket.closed = 0;
  Reflect.set(globalThis, "WebSocket", FakeWebSocket);
}

export function withinMs<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${what} did not finish in ${ms} ms`)), ms),
    ),
  ]);
}
