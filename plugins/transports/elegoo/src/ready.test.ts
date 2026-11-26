import { afterAll, afterEach, expect, spyOn, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PrintNotStartedError, type StageCtx } from "@conveyor/shared";
import { tempDirs } from "../../../../packages/shared/test/helpers/index.ts";
import { elegoo } from "./index";
import { elegooReadiness, elegooState } from "./ready";

const tempDir = tempDirs("conveyor-elegoo-ready-");
const RealWebSocket = globalThis.WebSocket;
const { preconnect } = globalThis.fetch;
const fetchSpy = spyOn(globalThis, "fetch");
afterEach(() => Reflect.set(globalThis, "WebSocket", RealWebSocket));
afterAll(() => fetchSpy.mockRestore());

const statusPush = (current: number[], print: number) =>
  JSON.stringify({
    Topic: "sdcp/status/mb",
    Data: { Status: { CurrentStatus: current, PrintInfo: { Status: print } } },
  });
const ERROR_PUSH = JSON.stringify({ Topic: "sdcp/error/mb", Data: { Data: { ErrorCode: 7 } } });

type Reply = string | "error" | "close" | "silent";

function printerSays(reply: Reply) {
  const asked: number[] = [];
  class Socket {
    onopen: (() => void) | null = null;
    onmessage: ((ev: { data: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: (() => void) | null = null;
    constructor(readonly url: string) {
      queueMicrotask(() => (reply === "error" ? this.onerror?.() : this.onopen?.()));
    }
    send(raw: string) {
      asked.push(JSON.parse(raw).Data.Cmd);
      if (reply === "close") return queueMicrotask(() => this.onclose?.());
      if (reply === "silent" || reply === "error") return;
      queueMicrotask(() => this.onmessage?.({ data: reply }));
    }
    close() {}
  }
  Reflect.set(globalThis, "WebSocket", Socket);
  return asked;
}

const frame = (currentStatus: number[], printStatus: number | null) => ({
  currentStatus,
  printStatus,
  progress: 0,
  currentLayer: null,
  totalLayer: null,
  currentTicks: null,
  totalTicks: null,
});

test.each([
  ["idle with nothing loaded", [0], 0, "idle"],
  ["idle after a finished print", [0], 9, "idle"],
  ["idle after a stopped print", [0], 8, "idle"],
  ["idle with no print info", [0], null, "idle"],
  ["printing", [1], 13, "printing"],
  ["pausing", [1], 5, "paused"],
  ["paused", [1], 6, "paused"],
  ["receiving a file", [2], 0, "printing"],
  ["homing before a print", [0], 1, "printing"],
] as const)("a printer that is %s reads as %s", (_name, current, print, readiness) => {
  expect(elegooState(frame([...current], print))).toBe(readiness);
});

test("asks for STATUS and reads the first status push", async () => {
  const asked = printerSays(statusPush([1], 13));
  expect(await elegooReadiness("10.0.0.8", "mb", 1000)).toBe("printing");
  expect(asked).toEqual([0]);
});

test("an SDCP error push reads as an error", async () => {
  printerSays(ERROR_PUSH);
  expect(await elegooReadiness("10.0.0.8", "mb", 1000)).toBe("error");
});

test.each([
  ["errors on connect", "error", "socket error"],
  ["closes without a status", "close", "socket closed before a status arrived"],
  ["never answers", "silent", "no status within 30 ms"],
] as const)("a printer that %s fails closed as not started", async (_name, reply, why) => {
  printerSays(reply);
  const check = elegooReadiness("10.0.0.8", "mb", 30);
  await expect(check).rejects.toBeInstanceOf(PrintNotStartedError);
  await expect(check).rejects.toThrow(`elegoo idle check from 10.0.0.8: ${why}`);
});

test.each([
  ["printing", statusPush([1], 13)],
  ["paused", statusPush([1], 6)],
  ["in error", ERROR_PUSH],
])("submit to a printer that is %s uploads nothing and starts nothing", async (_name, reply) => {
  const dir = await tempDir();
  const path = join(dir, "model.gcode");
  await writeFile(path, "G28\n");
  const asked = printerSays(reply);
  const uploads: string[] = [];
  const upload = async (url: string | URL | Request) => {
    uploads.push(String(url));
    return new Response("{}", { status: 200 });
  };
  fetchSpy.mockImplementation(Object.assign(upload, { preconnect }));
  const ctx: StageCtx = {
    jobId: "j",
    workDir: dir,
    signal: new AbortController().signal,
    report: () => {},
    log: () => {},
  };
  const target = { id: "p", transportId: "elegoo", address: "10.0.0.8", secrets: {} };
  await expect(elegoo.submit({ path, format: "gcode" }, target, ctx)).rejects.toBeInstanceOf(
    PrintNotStartedError,
  );
  expect(uploads).toEqual([]);
  expect(asked).toEqual([0]);
});
