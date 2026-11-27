import { afterEach, describe, expect, test } from "bun:test";
import { PrintMayHaveStartedError, PrintNotStartedError, StageError } from "@conveyor/shared";
import { startPrint } from "./index";

const RealWebSocket = globalThis.WebSocket;

afterEach(() => {
  Reflect.set(globalThis, "WebSocket", RealWebSocket);
});

type Mode = "ack" | "nack" | "closeAfterSend" | "errorBeforeOpen" | "errorAfterSend" | "strayFirst";

class StartSocket {
  static mode: Mode = "ack";
  static ackCode = 1;
  static sent = 0;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {
    if (StartSocket.mode === "errorBeforeOpen") queueMicrotask(() => this.onerror?.());
    else queueMicrotask(() => this.onopen?.());
  }
  send(raw: string) {
    StartSocket.sent++;
    const { RequestID } = JSON.parse(raw).Data;
    const mode = StartSocket.mode;
    if (mode === "closeAfterSend") return queueMicrotask(() => this.onclose?.());
    if (mode === "errorAfterSend") return queueMicrotask(() => this.onerror?.());
    if (mode === "strayFirst")
      for (const stray of ["pong", '{"Data":null}', '{"Data":{"RequestID":7}}'])
        queueMicrotask(() => this.onmessage?.({ data: stray }));
    const ack = { Data: { RequestID, Data: { Ack: mode === "nack" ? StartSocket.ackCode : 0 } } };
    queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(ack) }));
  }
  close() {}
}

function use(mode: Mode) {
  StartSocket.mode = mode;
  StartSocket.sent = 0;
  Reflect.set(globalThis, "WebSocket", StartSocket);
}

const start = () => startPrint("10.0.0.8", "mainboard-abc", "conveyor-job-1.gcode");

describe("elegoo START_PRINT", () => {
  test("an acked start resolves", async () => {
    use("ack");
    await expect(start()).resolves.toBeUndefined();
    expect(StartSocket.sent).toBe(1);
  });

  test("a start the printer rejects (busy, file not found, file errors) did not start", async () => {
    use("nack");
    for (const code of [1, 2, 3, 4, 5, 6, 7, 99]) {
      StartSocket.ackCode = code;
      const err = await start().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(PrintNotStartedError);
      expect(err).not.toBeInstanceOf(PrintMayHaveStartedError);
      expect(String(err)).toContain(`rejected (ack ${code})`);
    }
  });

  test("frames that aren't this start's ack are skipped until the ack arrives", async () => {
    use("strayFirst");
    await expect(start()).resolves.toBeUndefined();
  });

  test("a start sent but never acked may have started", async () => {
    for (const mode of ["closeAfterSend", "errorAfterSend"] as const) {
      use(mode);
      const err = await start().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(PrintMayHaveStartedError);
      expect(String(err)).toContain("elegoo START_PRINT was sent but not acknowledged");
    }
  });

  test("a socket that fails before the start is sent did not start", async () => {
    use("errorBeforeOpen");
    const err = await start().catch((e: unknown) => e);
    expect(StartSocket.sent).toBe(0);
    expect(err).toBeInstanceOf(StageError);
    expect(err).not.toBeInstanceOf(PrintMayHaveStartedError);
  });
});
