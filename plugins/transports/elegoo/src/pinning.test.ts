import { afterEach, expect, spyOn, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PrinterTarget, PrintHandle, PrintStatus, StageCtx } from "@conveyor/shared";
import { stubPrinterDns, tempDirs } from "../../../../packages/shared/test/helpers/index.ts";
import { elegoo } from "./index";
import { SDCP_CMD } from "./sdcp";

const LAN = ["192.168.1.61"];
const METADATA = ["169.254.169.254"];
const tempDir = tempDirs("conveyor-elegoo-pin-");
const RealWebSocket = globalThis.WebSocket;
const { preconnect } = globalThis.fetch;
const restores: (() => void)[] = [];
afterEach(() => {
  Reflect.set(globalThis, "WebSocket", RealWebSocket);
  for (const restore of restores.splice(0)) restore();
});

const idle = JSON.stringify({
  Topic: "sdcp/status/mb",
  Data: { Status: { CurrentStatus: [0], PrintInfo: { Status: 0 } } },
});
const finished = JSON.stringify({
  Topic: "sdcp/status/mb",
  Data: { Status: { CurrentStatus: [0], PrintInfo: { Status: 9, Filename: "a.gcode" } } },
});

class PinSocket {
  static urls: string[] = [];
  static pushOnOpen: string | undefined;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {
    PinSocket.urls.push(url);
    const push = PinSocket.pushOnOpen;
    queueMicrotask(() => {
      this.onopen?.();
      if (push) this.onmessage?.({ data: push });
    });
  }
  send(raw: string) {
    const { Cmd, RequestID } = JSON.parse(raw).Data;
    const reply = (data: Record<string, unknown>) =>
      queueMicrotask(() =>
        this.onmessage?.({
          data: JSON.stringify({
            Topic: "sdcp/response/mb",
            Data: { Cmd, Data: { Ack: 0, ...data }, RequestID },
          }),
        }),
      );
    if (Cmd === SDCP_CMD.STATUS) return queueMicrotask(() => this.onmessage?.({ data: idle }));
    if (Cmd === SDCP_CMD.FILE_LIST) return reply({ FileList: [] });
    reply({});
  }
  close() {}
}

function sockets(pushOnOpen?: string) {
  PinSocket.urls = [];
  PinSocket.pushOnOpen = pushOnOpen;
  Reflect.set(globalThis, "WebSocket", PinSocket);
}

function dns(...answers: string[][]) {
  const stub = stubPrinterDns(...(answers.length > 0 ? answers : [LAN, METADATA]));
  restores.push(stub.restore);
  return stub.asked;
}

const target: PrinterTarget = {
  id: "p1",
  transportId: "elegoo",
  address: "printer.example",
  secrets: { mainboardId: "mb" },
};

const pinnedSockets = () => {
  expect(PinSocket.urls.length).toBeGreaterThan(0);
  for (const url of PinSocket.urls) expect(url).toBe("ws://192.168.1.61:3030/websocket");
};

test("a submit's status reads, upload and START_PRINT all go to the checked IP", async () => {
  sockets();
  const asked = dns(LAN);
  const uploads: string[] = [];
  const spy = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: string | URL | Request) => {
        uploads.push(String(input));
        return new Response("{}", { status: 200 });
      },
      { preconnect },
    ),
  );
  restores.push(() => spy.mockRestore());
  const dir = await tempDir();
  const path = join(dir, "a.gcode");
  await writeFile(path, "G28\n");
  const ctx: StageCtx = {
    jobId: "pin",
    workDir: dir,
    signal: new AbortController().signal,
    report: () => {},
    log: () => {},
  };
  await elegoo.submit({ path, format: "gcode" }, target, ctx);
  expect(asked).toEqual(["printer.example", "printer.example"]);
  expect(uploads).toEqual(["http://192.168.1.61:3030/uploadFile/upload"]);
  expect(PinSocket.urls).toHaveLength(3);
  pinnedSockets();
});

test("the status stream opens at the checked IP", async () => {
  sockets(finished);
  dns();
  const handle: PrintHandle = {
    transportId: "elegoo",
    printerId: "p1",
    ref: "a.gcode",
    address: target.address,
    deviceId: "mb",
  };
  const states: PrintStatus["state"][] = [];
  for await (const status of elegoo.status(handle)) states.push(status.state);
  expect(states).toEqual(["transferring", "done"]);
  pinnedSockets();
});

test("pruning reads and lists the printer at the checked IP", async () => {
  sockets();
  dns();
  expect(await elegoo.pruneFiles?.(target, new Set(), new AbortController().signal)).toEqual([]);
  pinnedSockets();
});
