import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { type GcodeArtifact, type PrintHandle, PrintMayHaveStartedError } from "@conveyor/shared";
import { testCtx } from "../../../../packages/shared/test/helpers/index.ts";
import {
  elegoo,
  START_TIMEOUT_ENV,
  START_TIMEOUT_MAX_MS,
  START_TIMEOUT_MS,
  startPrint,
  startTimeoutMs,
} from "./index";

const RealWebSocket = globalThis.WebSocket;
const before = process.env[START_TIMEOUT_ENV];
const restores: (() => void)[] = [];

afterEach(() => {
  Reflect.set(globalThis, "WebSocket", RealWebSocket);
  for (const restore of restores.splice(0)) restore();
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

const handle: PrintHandle = {
  transportId: "elegoo",
  printerId: "p1",
  ref: "a.gcode",
  address: "10.0.0.8",
  deviceId: "mainboard-abc",
};

const refusal = (raw: string) =>
  `${START_TIMEOUT_ENV} must be a whole number of milliseconds from 1 to ${START_TIMEOUT_MAX_MS}, got ${raw}`;

function timerDelays(): () => unknown[] {
  const spy = spyOn(globalThis, "setTimeout");
  restores.push(() => spy.mockRestore());
  return () => spy.mock.calls.map((call) => call[1]);
}

describe(START_TIMEOUT_ENV, () => {
  test("defaults to 30 s when unset or empty", () => {
    expect(startTimeoutMs({})).toBe(30_000);
    expect(startTimeoutMs({ [START_TIMEOUT_ENV]: " " })).toBe(30_000);
    expect(startTimeoutMs({ [START_TIMEOUT_ENV]: "90000" })).toBe(90_000);
  });

  test("accepts 1 and the 10 minute ceiling", () => {
    expect(START_TIMEOUT_MAX_MS).toBe(600_000);
    expect(startTimeoutMs({ [START_TIMEOUT_ENV]: "1" })).toBe(1);
    expect(startTimeoutMs({ [START_TIMEOUT_ENV]: "600000" })).toBe(600_000);
  });

  test.each([
    "0",
    "-5",
    "1.5",
    "abc",
    "Infinity",
    "0x10",
    "1e3",
    "+500",
    "600001",
    "2147483648",
    "3000000000",
  ])("refuses %p, naming the variable and the range", (raw) => {
    expect(() => startTimeoutMs({ [START_TIMEOUT_ENV]: raw })).toThrow(refusal(raw));
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

  test("other commands ignore the setting", async () => {
    process.env[START_TIMEOUT_ENV] = "50";
    ackAfter(150);
    await expect(elegoo.cancel?.(handle)).resolves.toBeUndefined();
  });

  test("other commands wait 15 s for their ack", async () => {
    ackAfter(0);
    const delays = timerDelays();
    await elegoo.cancel?.(handle);
    expect(delays()).toContain(15_000);
    expect(delays()).not.toContain(START_TIMEOUT_MS);
  });

  test("a bad setting fails the submit before anything reaches the printer", async () => {
    process.env[START_TIMEOUT_ENV] = "soon";
    ackAfter(0);
    const target = { id: "p1", transportId: "elegoo", address: "10.0.0.8" };
    const gcode: GcodeArtifact = { path: "/nonexistent.gcode", format: "gcode" };
    const ctx = testCtx();
    try {
      await expect(elegoo.submit(gcode, target, ctx)).rejects.toThrow(refusal("soon"));
    } finally {
      ctx.cleanup();
    }
    expect(SlowAckSocket.opened).toBe(0);
  });
});
