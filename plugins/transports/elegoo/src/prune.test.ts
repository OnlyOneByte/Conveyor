import { afterEach, expect, test } from "bun:test";
import { elegoo } from "./index";
import { SDCP_CMD } from "./sdcp";

const RealWebSocket = globalThis.WebSocket;
afterEach(() => Reflect.set(globalThis, "WebSocket", RealWebSocket));

const target = { id: "p", transportId: "elegoo", address: "192.0.2.9", secrets: {} };

const LISTED = [
  { name: "/local/conveyor-a1.gcode", type: 1 },
  { name: "/local/conveyor-b2.gcode", type: 1 },
  { name: "/local/conveyor-c3.gcode", type: 1 },
  { name: "/local/benchy.gcode", type: 1 },
  { name: "/local/conveyor-d4.gcode", type: 0 },
];

interface Printer {
  status: number[];
  print: number;
  filename?: string;
  errData?: string[];
}

function printerSays({ status, print, filename, errData }: Printer) {
  const deletes: unknown[] = [];
  class Socket {
    onopen: (() => void) | null = null;
    onmessage: ((ev: { data: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: (() => void) | null = null;
    constructor(readonly url: string) {
      queueMicrotask(() => this.onopen?.());
    }
    send(raw: string) {
      const { Cmd, Data, RequestID } = JSON.parse(raw).Data;
      const reply = (data: Record<string, unknown>) =>
        queueMicrotask(() =>
          this.onmessage?.({
            data: JSON.stringify({
              Topic: "sdcp/response/mb",
              Data: { Cmd, Data: { Ack: 0, ...data }, RequestID },
            }),
          }),
        );
      if (Cmd === SDCP_CMD.STATUS)
        return queueMicrotask(() =>
          this.onmessage?.({
            data: JSON.stringify({
              Topic: "sdcp/status/mb",
              Data: {
                Status: { CurrentStatus: status, PrintInfo: { Status: print, Filename: filename } },
              },
            }),
          }),
        );
      if (Cmd === SDCP_CMD.FILE_LIST) return reply({ FileList: LISTED });
      if (Cmd === SDCP_CMD.DELETE_FILES) {
        deletes.push(Data);
        return reply(errData ? { ErrData: errData } : {});
      }
    }
    close() {}
  }
  Reflect.set(globalThis, "WebSocket", Socket);
  return deletes;
}

const prune = (keep: string[]) =>
  elegoo.pruneFiles?.(target, new Set(keep), new AbortController().signal);

test("deletes Conveyor's old files, sparing the kept one and the one printing", async () => {
  const deletes = printerSays({ status: [1], print: 13, filename: "conveyor-b2.gcode" });
  expect(await prune(["conveyor-c3.gcode"])).toEqual(["/local/conveyor-a1.gcode"]);
  expect(deletes).toEqual([{ FileList: ["/local/conveyor-a1.gcode"], FolderList: [] }]);
});

test("never deletes a file or folder Conveyor didn't make", async () => {
  const deletes = printerSays({ status: [0], print: 9 });
  await prune(["conveyor-a1.gcode", "conveyor-b2.gcode", "conveyor-c3.gcode"]);
  expect(deletes).toEqual([]);
});

test("deletes nothing when the printer is busy but names no file", async () => {
  const deletes = printerSays({ status: [1], print: 13 });
  await expect(prune([])).rejects.toThrow("elegoo is printing but names no file");
  expect(deletes).toEqual([]);
});

test("deletes nothing when the printer state is unknown", async () => {
  const deletes = printerSays({ status: [], print: 0 });
  await expect(prune([])).rejects.toThrow("elegoo gave no usable state");
  expect(deletes).toEqual([]);
});

test("a file the printer couldn't delete is reported", async () => {
  printerSays({ status: [0], print: 9, errData: ["/local/conveyor-a1.gcode"] });
  await expect(prune(["conveyor-b2.gcode", "conveyor-c3.gcode"])).rejects.toThrow(
    "elegoo could not delete /local/conveyor-a1.gcode",
  );
});
