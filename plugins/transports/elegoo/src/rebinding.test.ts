import { afterEach, expect, spyOn, test } from "bun:test";
import type { PrintHandle } from "@conveyor/shared";
import { printerDns } from "@conveyor/shared/node";
import { elegoo } from "./index";

const RealWebSocket = globalThis.WebSocket;
const restores: (() => void)[] = [];
afterEach(() => {
  Reflect.set(globalThis, "WebSocket", RealWebSocket);
  for (const restore of restores.splice(0)) restore();
});

class AckSocket {
  static urls: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {
    AckSocket.urls.push(url);
    queueMicrotask(() => this.onopen?.());
  }
  send(raw: string) {
    const { RequestID } = JSON.parse(raw).Data;
    const ack = { Data: { RequestID, Data: { Ack: 0 } } };
    queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(ack) }));
  }
  close() {}
}

function dnsAnswers(...answers: string[][]) {
  const asked: string[] = [];
  const spy = spyOn(printerDns, "resolve").mockImplementation(async (host: string) => {
    asked.push(host);
    return answers.shift() ?? [];
  });
  restores.push(() => spy.mockRestore());
  return asked;
}

const handle: PrintHandle = {
  transportId: "elegoo",
  printerId: "p1",
  ref: "a.gcode",
  address: "printer.example",
  deviceId: "mainboard-abc",
};

test("a stop connects to the IP the guard checked, so a name that rebinds to metadata is never reached", async () => {
  AckSocket.urls = [];
  Reflect.set(globalThis, "WebSocket", AckSocket);
  const asked = dnsAnswers(["192.168.1.61"], ["169.254.169.254"]);
  await elegoo.cancel?.(handle);
  expect(asked).toEqual(["printer.example"]);
  expect(AckSocket.urls).toEqual(["ws://192.168.1.61:3030/websocket"]);
  await expect(elegoo.cancel?.(handle)).rejects.toThrow(
    "Conveyor won't connect to printer.example",
  );
  expect(AckSocket.urls).toHaveLength(1);
});
