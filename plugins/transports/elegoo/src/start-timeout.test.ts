import { afterEach, describe, expect, test } from "bun:test";
import { type GcodeArtifact, type PrintHandle, PrintMayHaveStartedError } from "@conveyor/shared";
import { testCtx } from "../../../../packages/shared/test/helpers/index.ts";
import { elegoo, START_TIMEOUT_ENV, startPrint, startTimeoutMs } from "./index";

const RealWebSocket = globalThis.WebSocket;
const before = process.env[START_TIMEOUT_ENV];

afterEach(() => {
  Reflect.set(globalThis, "WebSocket", RealWebSocket);
  if (before === undefined) delete process.env[START_TIMEOUT_ENV];
  else process.env[START_TIMEOUT_ENV] = before;
});

class SlowAckSocket {
  static ackAfterMs = 0;
  static opened = 0;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {
    SlowAckSocket.opened++;
    queueMicrotask(() => this.onopen?.());
  }
  send(raw: string) {
    const { RequestID } = JSON.parse(raw).Data;
    const ack = JSON.stringify({ Data: { RequestID, Data: { Ack: 0 } } });
    setTimeout(() => this.onmessage?.({ data: ack }), SlowAckSocket.ackAfterMs);
  }
  close() {}
}

function ackAfter(ms: number) {
  SlowAckSocket.ackAfterMs = ms;
  SlowAckSocket.opened = 0;
  Reflect.set(globalThis, "WebSocket", SlowAckSocket);
}

const start = () => startPrint("10.0.0.8", "mainboard-abc", "conveyor-job-1.gcode");

describe(START_TIMEOUT_ENV, () => {
  test("defaults to 30 s when unset or empty", () => {
    expect(startTimeoutMs({})).toBe(30_000);
    expect(startTimeoutMs({ [START_TIMEOUT_ENV]: " " })).toBe(30_000);
    expect(startTimeoutMs({ [START_TIMEOUT_ENV]: "90000" })).toBe(90_000);
  });

  test.each(["0", "-5", "1.5", "abc", "Infinity"])("refuses %p, naming the variable", (raw) => {
    expect(() => startTimeoutMs({ [START_TIMEOUT_ENV]: raw })).toThrow(
      `${START_TIMEOUT_ENV} must be a whole number above 0, got ${raw}`,
    );
  });

  test("a slow ack inside the setting resolves", async () => {
    process.env[START_TIMEOUT_ENV] = "400";
    ackAfter(100);
    await expect(start()).resolves.toBeUndefined();
  });

  test("an ack slower than the setting may have started, and says how long it waited", async () => {
    process.env[START_TIMEOUT_ENV] = "50";
    ackAfter(150);
    const err = await start().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PrintMayHaveStartedError);
    expect(String(err)).toContain("timed out after 50 ms");
  });

  test("other commands keep their own wait", async () => {
    process.env[START_TIMEOUT_ENV] = "50";
    ackAfter(150);
    const handle: PrintHandle = {
      transportId: "elegoo",
      printerId: "p1",
      ref: "a.gcode",
      address: "10.0.0.8",
      deviceId: "mainboard-abc",
    };
    await expect(elegoo.cancel?.(handle)).resolves.toBeUndefined();
  });

  test("a bad setting fails the submit before anything reaches the printer", async () => {
    process.env[START_TIMEOUT_ENV] = "soon";
    ackAfter(0);
    const target = { id: "p1", transportId: "elegoo", address: "10.0.0.8" };
    const gcode: GcodeArtifact = { path: "/nonexistent.gcode", format: "gcode" };
    await expect(elegoo.submit(gcode, target, testCtx())).rejects.toThrow(
      `${START_TIMEOUT_ENV} must be a whole number above 0, got soon`,
    );
    expect(SlowAckSocket.opened).toBe(0);
  });
});
