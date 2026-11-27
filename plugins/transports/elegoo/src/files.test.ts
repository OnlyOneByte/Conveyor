import { afterAll, afterEach, expect, spyOn, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PrintNotStartedError, type StageCtx } from "@conveyor/shared";
import { tempDirs } from "../../../../packages/shared/test/helpers/index.ts";
import { elegoo } from "./index";

const tempDir = tempDirs("conveyor-elegoo-files-");
const RealWebSocket = globalThis.WebSocket;
const IDLE_PUSH = JSON.stringify({
  Topic: "sdcp/status/mb",
  Data: { Status: { CurrentStatus: [0], PrintInfo: { Status: 0, TaskId: "task-before" } } },
});
const { preconnect } = globalThis.fetch;
const fetchSpy = spyOn(globalThis, "fetch");
const started: string[] = [];

class AckingSocket {
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {
    queueMicrotask(() => this.onopen?.());
  }
  send(raw: string) {
    if (JSON.parse(raw).Data.Cmd === 0)
      return queueMicrotask(() => this.onmessage?.({ data: IDLE_PUSH }));
    const frame = JSON.parse(raw);
    if (frame.Data.Data?.Filename) started.push(frame.Data.Data.Filename);
    const ack = { Data: { RequestID: frame.Data.RequestID, Data: { Ack: 0 } } };
    queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(ack) }));
  }
  close() {}
}

afterEach(() => Reflect.set(globalThis, "WebSocket", RealWebSocket));
afterAll(() => fetchSpy.mockRestore());

test("two jobs to one printer upload and start their own files", async () => {
  Reflect.set(globalThis, "WebSocket", AckingSocket);
  const dir = await tempDir();
  const path = join(dir, "model.gcode");
  await writeFile(path, "G28\n");
  const uploaded: string[] = [];
  const upload = async (_url: string | URL | Request, init?: RequestInit) => {
    const form = await new Response(init?.body, { headers: new Headers(init?.headers) }).formData();
    for (const [, value] of form) if (typeof value !== "string") uploaded.push(value.name);
    return new Response("{}", { status: 200 });
  };
  fetchSpy.mockImplementation(Object.assign(upload, { preconnect }));
  const ctx = (jobId: string): StageCtx => ({
    jobId,
    workDir: dir,
    signal: new AbortController().signal,
    report: () => {},
    log: () => {},
  });
  const target = { id: "p", transportId: "elegoo", address: "10.0.0.8", secrets: {} };
  const first = await elegoo.submit({ path, format: "gcode" }, target, ctx("a1"));
  const second = await elegoo.submit({ path, format: "gcode" }, target, ctx("b2"));
  expect([first.ref, second.ref]).toEqual(["conveyor-a1.gcode", "conveyor-b2.gcode"]);
  expect([first.priorTask, second.priorTask]).toEqual(["task-before", "task-before"]);
  expect(uploaded).toEqual(["conveyor-a1.gcode", "conveyor-b2.gcode"]);
  expect(started).toEqual(["conveyor-a1.gcode", "conveyor-b2.gcode"]);
});

test("a start the worker can no longer confirm uploads but never sends START_PRINT", async () => {
  Reflect.set(globalThis, "WebSocket", AckingSocket);
  started.length = 0;
  const dir = await tempDir();
  const path = join(dir, "model.gcode");
  await writeFile(path, "G28\n");
  fetchSpy.mockImplementation(
    Object.assign(async () => new Response("{}", { status: 200 }), { preconnect }),
  );
  const ctx: StageCtx = {
    jobId: "j",
    workDir: dir,
    signal: new AbortController().signal,
    report: () => {},
    log: () => {},
    confirmStart: async () => {
      throw new PrintNotStartedError("the printer lock was lost");
    },
  };
  const target = { id: "p", transportId: "elegoo", address: "10.0.0.8", secrets: {} };
  await expect(elegoo.submit({ path, format: "gcode" }, target, ctx)).rejects.toBeInstanceOf(
    PrintNotStartedError,
  );
  expect(started).toEqual([]);
});
