import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type PrintHandle, PrintNotStartedError, type StageCtx } from "@conveyor/shared";
import { elegoo } from "./index";

const RealWebSocket = globalThis.WebSocket;
const { preconnect } = globalThis.fetch;
const fetchSpy = spyOn(globalThis, "fetch");

afterEach(() => {
  Reflect.set(globalThis, "WebSocket", RealWebSocket);
});

afterAll(() => {
  fetchSpy.mockRestore();
});

class AckingSocket {
  static urls: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {
    AckingSocket.urls.push(url);
    queueMicrotask(() => this.onopen?.());
  }
  send(raw: string) {
    const ack = { Data: { RequestID: JSON.parse(raw).Data.RequestID, Data: { Ack: 0 } } };
    queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(ack) }));
  }
  close() {}
}

function useAckingSocket() {
  AckingSocket.urls = [];
  Reflect.set(globalThis, "WebSocket", AckingSocket);
}

const handle: PrintHandle = {
  transportId: "elegoo",
  printerId: "conveyor-printer-1",
  ref: "a.gcode",
  address: "10.0.0.8",
  deviceId: "mainboard-abc",
};

describe("elegoo printer addresses", () => {
  test("a bare IPv6 address is bracketed in the WebSocket URL", async () => {
    useAckingSocket();
    await elegoo.cancel?.({ ...handle, address: "fd00::1" });
    expect(AckingSocket.urls).toEqual(["ws://[fd00::1]:3030/websocket"]);
  });

  test("a bare IPv6 address is bracketed in the upload URL", async () => {
    useAckingSocket();
    const dir = await mkdtemp(join(tmpdir(), "conveyor-elegoo-"));
    const path = join(dir, "a.gcode");
    await writeFile(path, "G28\n");
    const controller = new AbortController();
    const urls: string[] = [];
    const upload = async (url: string | URL | Request) => {
      urls.push(String(url));
      controller.abort();
      return new Response("{}", { status: 200 });
    };
    fetchSpy.mockImplementation(Object.assign(upload, { preconnect }));
    const ctx: StageCtx = {
      jobId: "j",
      workDir: dir,
      signal: controller.signal,
      report: () => {},
      log: () => {},
    };
    const target = { id: "p", transportId: "elegoo", address: "fd00::1", secrets: {} };
    await expect(elegoo.submit({ path, format: "gcode" }, target, ctx)).rejects.toBeInstanceOf(
      PrintNotStartedError,
    );
    expect(urls).toEqual(["http://[fd00::1]:3030/uploadFile/upload"]);
  });

  test("an ambiguous address fails the command with the parser's reason", async () => {
    useAckingSocket();
    const stop = elegoo.cancel?.({ ...handle, address: "fe80::1::2" }) ?? Promise.resolve();
    await expect(stop).rejects.toThrow('elegoo printer address "fe80::1::2": not a valid IPv6');
    expect(AckingSocket.urls).toHaveLength(0);
  });
});
