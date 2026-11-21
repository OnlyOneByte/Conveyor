import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { getEventListeners } from "node:events";
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
const ERROR = JSON.stringify({ Topic: "sdcp/error/mb", Data: { Data: { ErrorCode: 1 } } });
const TIMED_OUT: Outcome = {
  kind: "failed",
  message: `[transport] elegoo status from 10.0.0.8: no print status for ${IDLE_TIMEOUT_MS} ms`,
};

class LiveSocket {
  static current: LiveSocket | null = null;
  static closed = 0;
  static sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {
    LiveSocket.current = this;
    queueMicrotask(() => this.onopen?.());
  }
  send(data: string) {
    LiveSocket.sent.push(data);
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
  LiveSocket.sent = [];
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

async function answerRefreshes(minutes: number, reply: string): Promise<void> {
  for (let minute = 1; minute <= minutes; minute++) {
    const before = LiveSocket.sent.length;
    await wait(MINUTE_MS);
    if (LiveSocket.sent.length > before) await push(reply);
  }
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
    expect(run.outcome()).toEqual(TIMED_OUT);
    expect(LiveSocket.closed).toBe(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  test("notice frames alone do not keep the print alive", async () => {
    const run = await startRun();
    for (let minute = 1; minute <= 11; minute++) {
      await wait(MINUTE_MS);
      await push(NOTICE);
    }
    expect(run.outcome()).toEqual(TIMED_OUT);
  });

  test("an error while printing followed by idle frames fails within the idle timeout", async () => {
    const run = await startRun();
    await push(statusFrame(13, 40));
    await push(ERROR);
    for (let minute = 1; minute < 10; minute++) {
      await wait(MINUTE_MS);
      await push(IDLE);
    }
    expect(run.outcome()).toEqual({ kind: "pending" });
    await wait(MINUTE_MS);
    expect(run.outcome()).toEqual(TIMED_OUT);
    expect(run.seen.at(-1)?.message).toBe("printer reported SDCP error 1 while printing");
  });

  test("repeated sdcp/error frames do not keep the print alive", async () => {
    const run = await startRun();
    await push(statusFrame(13, 40));
    for (let minute = 1; minute < 10; minute++) {
      await wait(MINUTE_MS);
      await push(ERROR);
    }
    expect(run.outcome()).toEqual({ kind: "pending" });
    await wait(MINUTE_MS);
    expect(run.outcome()).toEqual(TIMED_OUT);
  });

  test("a finished stream leaves no timers or abort listeners behind", async () => {
    const run = await startRun();
    await push(statusFrame(13, 10));
    await push(statusFrame(9, 100));
    expect(run.outcome()).toEqual({ kind: "finished" });
    expect(jest.getTimerCount()).toBe(0);
    expect(getEventListeners(abort.signal, "abort")).toHaveLength(0);
  });
});

describe("elegoo status refresh", () => {
  test("the stream asks the printer for status with Cmd 0 every half idle timeout", async () => {
    await startRun();
    await wait(IDLE_TIMEOUT_MS / 2 - 1);
    expect(LiveSocket.sent).toHaveLength(0);
    await wait(1);
    expect(LiveSocket.sent).toHaveLength(1);
    expect(LiveSocket.sent[0]).toMatch(
      /"Cmd":0,"Data":\{\},"RequestID":"[^"]+","MainboardID":"mainboard-abc"/,
    );
  });

  test("a 30-minute pause answered by status refreshes stays alive and then completes", async () => {
    const run = await startRun();
    await push(statusFrame(13, 40));
    await answerRefreshes(30, statusFrame(6, 40));
    expect(run.outcome()).toEqual({ kind: "pending" });
    expect(LiveSocket.sent).toHaveLength(6);
    await push(statusFrame(13, 41));
    await push(statusFrame(9, 100));
    expect(run.outcome()).toEqual({ kind: "finished" });
    expect(run.seen.at(-1)).toEqual({ state: "done", progress: 1 });
  });

  test("a halted printer that answers refreshes with idle still fails at the idle timeout", async () => {
    const run = await startRun();
    await push(statusFrame(13, 40));
    await answerRefreshes(9, IDLE);
    expect(run.outcome()).toEqual({ kind: "pending" });
    await answerRefreshes(1, IDLE);
    expect(run.outcome()).toEqual(TIMED_OUT);
    expect(jest.getTimerCount()).toBe(0);
  });
});
