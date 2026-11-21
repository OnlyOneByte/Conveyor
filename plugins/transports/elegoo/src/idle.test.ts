import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import type { PrintHandle, PrintStatus } from "@conveyor/shared";
import { elegoo } from "./index";

const RealWebSocket = globalThis.WebSocket;
const MINUTE_MS = 60 * 1000;
const IDLE_TIMEOUT_MS = 10 * MINUTE_MS;
const NOTICE = JSON.stringify({ Topic: "sdcp/notice/mb", Data: { Data: { Message: "hi" } } });
const IDLE = JSON.stringify({
  Topic: "sdcp/status/mb",
  Data: { Status: { CurrentStatus: [0], PrintInfo: { Status: 0 } } },
});

class LiveSocket {
  static current: LiveSocket | null = null;
  static closed = 0;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {
    LiveSocket.current = this;
  }
  close() {
    LiveSocket.closed++;
  }
}

type Outcome = { kind: "pending" } | { kind: "finished" } | { kind: "failed"; message: string };

interface Run {
  seen: PrintStatus[];
  outcome: () => Outcome;
}

const handle: PrintHandle = {
  transportId: "elegoo",
  printerId: "conveyor-printer-1",
  ref: "a.gcode",
  address: "10.0.0.8",
  deviceId: "mainboard-abc",
};

let abort = new AbortController();

beforeEach(() => {
  jest.useFakeTimers();
  LiveSocket.current = null;
  LiveSocket.closed = 0;
  abort = new AbortController();
  Reflect.set(globalThis, "WebSocket", LiveSocket);
});

afterEach(() => {
  abort.abort();
  jest.useRealTimers();
  Reflect.set(globalThis, "WebSocket", RealWebSocket);
});

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

async function startRun(): Promise<Run> {
  const seen: PrintStatus[] = [];
  let outcome: Outcome = { kind: "pending" };
  (async () => {
    for await (const s of elegoo.status(handle, abort.signal)) seen.push(s);
  })().then(
    () => {
      outcome = { kind: "finished" };
    },
    (e: unknown) => {
      outcome = { kind: "failed", message: e instanceof Error ? e.message : String(e) };
    },
  );
  await settle();
  return { seen, outcome: () => outcome };
}

async function push(data: string): Promise<void> {
  LiveSocket.current?.onmessage?.({ data });
  await settle();
}

async function wait(ms: number): Promise<void> {
  jest.advanceTimersByTime(ms);
  await settle();
}

function statusFrame(printStatus: number, progress: number): string {
  return JSON.stringify({
    Topic: "sdcp/status/mb",
    Data: {
      Status: { CurrentStatus: [1], PrintInfo: { Status: printStatus, Progress: progress } },
    },
  });
}

describe("elegoo status idle timeout", () => {
  test("a 30-minute print that keeps reporting completes", async () => {
    const run = await startRun();
    for (let minute = 1; minute <= 30; minute++) {
      await wait(MINUTE_MS);
      await push(statusFrame(13, minute * 3));
    }
    await push(statusFrame(9, 100));
    expect(run.outcome()).toEqual({ kind: "finished" });
    expect(run.seen.at(-1)).toEqual({ state: "done", progress: 1 });
    expect(run.seen.filter((s) => s.state === "printing")).toHaveLength(30);
    expect(LiveSocket.closed).toBe(1);
  });

  test("silence fails the print once the idle timeout passes", async () => {
    const run = await startRun();
    await push(statusFrame(13, 10));
    await wait(IDLE_TIMEOUT_MS - 1);
    expect(run.outcome()).toEqual({ kind: "pending" });
    await wait(1);
    expect(run.outcome()).toEqual({
      kind: "failed",
      message: `[transport] elegoo status from 10.0.0.8: no print status for ${IDLE_TIMEOUT_MS} ms`,
    });
    expect(LiveSocket.closed).toBe(1);
  });

  test("notice frames alone do not keep the print alive", async () => {
    const run = await startRun();
    for (let minute = 1; minute <= 11; minute++) {
      await wait(MINUTE_MS);
      await push(NOTICE);
    }
    expect(run.outcome()).toEqual({
      kind: "failed",
      message: `[transport] elegoo status from 10.0.0.8: no print status for ${IDLE_TIMEOUT_MS} ms`,
    });
  });

  test("an error while printing followed by idle frames fails within the idle timeout", async () => {
    const run = await startRun();
    await push(statusFrame(13, 40));
    await push(JSON.stringify({ Topic: "sdcp/error/mb", Data: { Data: { ErrorCode: 1 } } }));
    for (let minute = 1; minute < 10; minute++) {
      await wait(MINUTE_MS);
      await push(IDLE);
    }
    expect(run.outcome()).toEqual({ kind: "pending" });
    await wait(MINUTE_MS);
    expect(run.outcome()).toEqual({
      kind: "failed",
      message: `[transport] elegoo status from 10.0.0.8: no print status for ${IDLE_TIMEOUT_MS} ms`,
    });
    expect(run.seen.at(-1)?.message).toBe("printer reported SDCP error 1 while printing");
  });
});
