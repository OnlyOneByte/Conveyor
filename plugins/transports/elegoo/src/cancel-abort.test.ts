import { afterEach, expect, test } from "bun:test";
import type { PrintHandle } from "@conveyor/shared";
import { holdPrinterDns } from "../../../../packages/shared/test/helpers/index.ts";
import { elegoo } from "./index";

const RealWebSocket = globalThis.WebSocket;
const restores: (() => void)[] = [];
afterEach(() => {
  Reflect.set(globalThis, "WebSocket", RealWebSocket);
  for (const restore of restores.splice(0)) restore();
});

class HeldSocket {
  static made: HeldSocket[] = [];
  static sent = 0;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {
    HeldSocket.made.push(this);
  }
  send() {
    HeldSocket.sent++;
  }
  close() {}
}

function useHeldSockets() {
  HeldSocket.made = [];
  HeldSocket.sent = 0;
  Reflect.set(globalThis, "WebSocket", HeldSocket);
}

const handle: PrintHandle = {
  transportId: "elegoo",
  printerId: "p1",
  ref: "a.gcode",
  address: "printer.example",
  deviceId: "mainboard-abc",
};

test("a stop whose lookup answers after it was aborted opens no socket", async () => {
  useHeldSockets();
  const dns = holdPrinterDns(["192.168.1.61"]);
  restores.push(dns.restore);
  const bound = new AbortController();
  const stop = elegoo.cancel?.(handle, undefined, bound.signal);
  bound.abort();
  dns.answer();
  await expect(stop).rejects.toThrow("elegoo cmd 130 abandoned before it was sent");
  expect(HeldSocket.made).toEqual([]);
});

test("a stop aborted while its socket is still connecting never sends STOP_PRINT", async () => {
  useHeldSockets();
  const bound = new AbortController();
  const stop = elegoo.cancel?.({ ...handle, address: "192.168.1.61" }, undefined, bound.signal);
  while (HeldSocket.made.length === 0) await Bun.sleep(1);
  bound.abort();
  HeldSocket.made[0]?.onopen?.();
  await expect(stop).rejects.toThrow("abandoned before it was sent");
  expect(HeldSocket.sent).toBe(0);
});
