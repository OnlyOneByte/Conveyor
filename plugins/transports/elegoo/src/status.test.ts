import { afterEach, describe, expect, test } from "bun:test";
import type { PrintHandle, PrintStatus } from "@conveyor/shared";
import { elegoo } from "./index";
import { MAX_BAD_STATUS_FRAMES } from "./socket";

const RealWebSocket = globalThis.WebSocket;
const BAD = "<html>busy</html>";
const NOTICE = JSON.stringify({ Topic: "sdcp/notice/mb", Data: { Data: { Message: "hi" } } });

afterEach(() => {
  Reflect.set(globalThis, "WebSocket", RealWebSocket);
});

class PushSocket {
  static pushes: string[] = [];
  static hangsUp = false;
  static closed = 0;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {
    for (const data of PushSocket.pushes) queueMicrotask(() => this.onmessage?.({ data }));
    if (PushSocket.hangsUp) queueMicrotask(() => this.onclose?.());
  }
  close() {
    PushSocket.closed++;
  }
}

function usePushes(pushes: string[], hangsUp = false) {
  PushSocket.pushes = pushes;
  PushSocket.hangsUp = hangsUp;
  PushSocket.closed = 0;
  Reflect.set(globalThis, "WebSocket", PushSocket);
}

const handle: PrintHandle = {
  transportId: "elegoo",
  printerId: "conveyor-printer-1",
  ref: "a.gcode",
  address: "10.0.0.8",
  deviceId: "mainboard-abc",
};

async function drainStatus(): Promise<PrintStatus[]> {
  const seen: PrintStatus[] = [];
  const drain = (async () => {
    for await (const s of elegoo.status(handle)) seen.push(s);
  })();
  await Promise.race([
    drain,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("elegoo status did not finish in 1000 ms")), 1000),
    ),
  ]);
  return seen;
}

function statusFrame(printStatus: number, progress: number): string {
  return JSON.stringify({
    Topic: "sdcp/status/mb",
    Data: {
      Status: { CurrentStatus: [1], PrintInfo: { Status: printStatus, Progress: progress } },
    },
  });
}

function errorFrame(code: number | string): string {
  return JSON.stringify({ Topic: "sdcp/error/mb", Data: { Data: { ErrorCode: code } } });
}

describe("elegoo status stream", () => {
  test("three unreadable status frames end the stream with a transport error", async () => {
    usePushes(Array(MAX_BAD_STATUS_FRAMES).fill(BAD));
    await expect(drainStatus()).rejects.toThrow(
      "elegoo status from 10.0.0.8: 3 unreadable frames since the last status, last: JSON Parse error",
    );
    expect(PushSocket.closed).toBe(1);
  });

  test("notice frames between unreadable frames do not reset the count", async () => {
    usePushes([BAD, NOTICE, BAD, NOTICE, BAD, NOTICE]);
    await expect(drainStatus()).rejects.toThrow("3 unreadable frames since the last status");
  });

  test("a readable status frame resets the unreadable-frame count", async () => {
    const bad = Array(MAX_BAD_STATUS_FRAMES - 1).fill(BAD);
    usePushes([...bad, statusFrame(13, 40), ...bad], true);
    const seen = await drainStatus();
    expect(seen.map((s) => s.state)).toEqual(["transferring", "printing"]);
  });

  test("an sdcp/error before printing is observed fails the print with its code", async () => {
    usePushes([errorFrame(1)]);
    const seen = await drainStatus();
    expect(seen.map((s) => s.state)).toEqual(["transferring", "failed"]);
    expect(seen[1]?.message).toBe("printer reported SDCP error 1");
  });

  test("a string error code fails the print the same way", async () => {
    usePushes([errorFrame("2")]);
    const seen = await drainStatus();
    expect(seen[1]).toEqual({ state: "failed", message: "printer reported SDCP error 2" });
  });

  test("an sdcp/error while printing is kept as a note and the print continues", async () => {
    usePushes([statusFrame(13, 10), errorFrame(1), statusFrame(9, 100)]);
    const seen = await drainStatus();
    expect(seen).toEqual([
      { state: "transferring" },
      { state: "printing", progress: 0.1 },
      { state: "printing", progress: 0.1, message: "printer reported SDCP error 1 while printing" },
      { state: "done", progress: 1 },
    ]);
  });

  test("a spec-shaped frame with Status at the top level completes the print", async () => {
    const done = JSON.stringify({
      Topic: "sdcp/status/mb",
      MainboardID: "mb",
      TimeStamp: 1,
      Status: { CurrentStatus: [0], PrintInfo: { Status: 9 } },
    });
    usePushes([done]);
    const seen = await drainStatus();
    expect(seen.map((s) => s.state)).toEqual(["transferring", "done"]);
  });
});
