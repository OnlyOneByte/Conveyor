import { afterAll, afterEach, expect, spyOn, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PrintNotStartedError, type PrintStatus, type StageCtx } from "@conveyor/shared";
import { tempDirs } from "../../../../packages/shared/test/helpers/index.ts";
import { elegoo } from "./index";

const tempDir = tempDirs("conveyor-elegoo-race-");
const RealWebSocket = globalThis.WebSocket;
const { preconnect } = globalThis.fetch;
const fetchSpy = spyOn(globalThis, "fetch");

const status = (CurrentStatus: number, Status: number, TaskId?: string) =>
  JSON.stringify({
    Topic: "sdcp/status/mb",
    Data: { Status: { CurrentStatus: [CurrentStatus], PrintInfo: { Status, TaskId } } },
  });

class PrinterSocket {
  static statusReplies: string[] = [];
  static streamPushes: string[] = [];
  static streaming = false;
  static ack = 0;
  static starts = 0;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {
    queueMicrotask(() => this.onopen?.());
    if (PrinterSocket.streaming)
      for (const data of PrinterSocket.streamPushes)
        queueMicrotask(() => this.onmessage?.({ data }));
  }
  send(raw: string) {
    const frame = JSON.parse(raw);
    if (frame.Data.Cmd === 0) {
      const reply = PrinterSocket.statusReplies.shift();
      if (reply) queueMicrotask(() => this.onmessage?.({ data: reply }));
      return;
    }
    if (frame.Data.Data?.Filename) PrinterSocket.starts++;
    const ack = { Data: { RequestID: frame.Data.RequestID, Data: { Ack: PrinterSocket.ack } } };
    queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(ack) }));
  }
  close() {}
}

afterEach(() => {
  Reflect.set(globalThis, "WebSocket", RealWebSocket);
  PrinterSocket.streaming = false;
  PrinterSocket.ack = 0;
  PrinterSocket.starts = 0;
});

async function submitted(jobId: string) {
  const dir = await tempDir();
  const path = join(dir, "model.gcode");
  await writeFile(path, "G28\n");
  fetchSpy.mockImplementation(
    Object.assign(async () => new Response("{}", { status: 200 }), { preconnect }),
  );
  const ctx: StageCtx = {
    jobId,
    workDir: dir,
    signal: new AbortController().signal,
    report: () => {},
    log: () => {},
  };
  const target = { id: "p", transportId: "elegoo", address: "10.0.0.8", secrets: {} };
  return elegoo.submit({ path, format: "gcode" }, target, ctx);
}
afterAll(() => fetchSpy.mockRestore());

async function drain(statuses: AsyncIterable<PrintStatus>): Promise<string[]> {
  const seen: string[] = [];
  const done = (async () => {
    for await (const s of statuses) seen.push(s.state);
  })();
  await Promise.race([
    done,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("elegoo status did not finish in 1000 ms")), 1000),
    ),
  ]);
  return seen;
}

test.each([
  ["completed", 9],
  ["stopped", 8],
])(
  "a print that starts and ends on the printer during our upload (%s) doesn't end our job",
  async (_label, ended) => {
    Reflect.set(globalThis, "WebSocket", PrinterSocket);
    PrinterSocket.statusReplies = [status(0, 0), status(0, ended, "task-intruder")];
    PrinterSocket.streamPushes = [status(0, ended, "task-intruder"), status(1, 13, "task-ours")];
    PrinterSocket.streamPushes.push(status(0, 9, "task-ours"));
    const dir = await tempDir();
    const path = join(dir, "model.gcode");
    await writeFile(path, "G28\n");
    fetchSpy.mockImplementation(
      Object.assign(async () => new Response("{}", { status: 200 }), { preconnect }),
    );
    const ctx: StageCtx = {
      jobId: "race",
      workDir: dir,
      signal: new AbortController().signal,
      report: () => {},
      log: () => {},
    };
    const target = { id: "p", transportId: "elegoo", address: "10.0.0.8", secrets: {} };
    const handle = await elegoo.submit({ path, format: "gcode" }, target, ctx);
    expect(handle.priorTask).toBe("task-intruder");
    expect(PrinterSocket.statusReplies).toEqual([]);
    PrinterSocket.streaming = true;
    expect(await drain(elegoo.status(handle))).toEqual(["transferring", "printing", "done"]);
  },
);

test.each([
  ["would accept it", 0],
  ["would refuse it as busy", 1],
])(
  "a printer that turned busy during the upload gets no START, even one that %s",
  async (_label, ack) => {
    Reflect.set(globalThis, "WebSocket", PrinterSocket);
    PrinterSocket.ack = ack;
    PrinterSocket.statusReplies = [status(0, 0), status(1, 13, "task-other")];
    const err = await submitted("busy").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PrintNotStartedError);
    expect(String(err)).toContain("printer is busy: elegoo reports it printing");
    expect(PrinterSocket.starts).toBe(0);
    expect(PrinterSocket.statusReplies).toEqual([]);
  },
);
