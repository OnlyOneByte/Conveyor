import { afterEach, expect, test } from "bun:test";
import { PrintMayHaveStartedError, PrintNotStartedError, StageError } from "@conveyor/shared";
import { startPrint } from "./index";

const RealWebSocket = globalThis.WebSocket;
afterEach(() => Reflect.set(globalThis, "WebSocket", RealWebSocket));

class SilentSocket {
  static made: SilentSocket[] = [];
  static sent = 0;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {
    SilentSocket.made.push(this);
  }
  send() {
    SilentSocket.sent++;
  }
  close() {}
}

function silent() {
  SilentSocket.made = [];
  SilentSocket.sent = 0;
  Reflect.set(globalThis, "WebSocket", SilentSocket);
}

const start = (signal: AbortSignal) =>
  startPrint("10.0.0.8", "mainboard-abc", "conveyor-job-1.gcode", 30_000, signal).catch(
    (e: unknown) => e,
  );

test("a cancel while waiting for the START_PRINT ack stops the wait, and doesn't say the print may have started", async () => {
  silent();
  const job = new AbortController();
  const waiting = start(job.signal);
  while (SilentSocket.made.length === 0) await Bun.sleep(1);
  SilentSocket.made[0]?.onopen?.();
  expect(SilentSocket.sent).toBe(1);
  const at = Date.now();
  job.abort();
  const err = await waiting;
  expect(Date.now() - at).toBeLessThan(100);
  expect(err).toBeInstanceOf(StageError);
  expect(err).not.toBeInstanceOf(PrintMayHaveStartedError);
  expect(err).not.toBeInstanceOf(PrintNotStartedError);
  expect(String(err)).toContain("canceled while waiting for the START_PRINT ack");
});

test("a cancel before START_PRINT goes out means the print didn't start", async () => {
  silent();
  const job = new AbortController();
  const waiting = start(job.signal);
  while (SilentSocket.made.length === 0) await Bun.sleep(1);
  job.abort();
  SilentSocket.made[0]?.onopen?.();
  const err = await waiting;
  expect(SilentSocket.sent).toBe(0);
  expect(err).toBeInstanceOf(PrintNotStartedError);
  expect(String(err)).toContain("canceled before START_PRINT");
});
