import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type PrintHandle, PrintNotStartedError, type StageCtx } from "@conveyor/shared";
import { elegoo } from "./index";
import { SDCP_CMD } from "./sdcp";

const RealWebSocket = globalThis.WebSocket;

afterEach(() => {
  Reflect.set(globalThis, "WebSocket", RealWebSocket);
});

type Mode = "ack" | "nack" | "close" | "silent";

class FakeWebSocket {
  static mode: Mode = "ack";
  static sent: { url: string; frame: { Data: { Cmd: number; MainboardID: string } } }[] = [];
  static closed = 0;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {
    queueMicrotask(() => this.onopen?.());
  }
  send(raw: string) {
    const frame = JSON.parse(raw);
    FakeWebSocket.sent.push({ url: this.url, frame });
    if (FakeWebSocket.mode === "close") queueMicrotask(() => this.onclose?.());
    if (FakeWebSocket.mode !== "ack" && FakeWebSocket.mode !== "nack") return;
    const code = FakeWebSocket.mode === "ack" ? 0 : 1;
    const ack = { Data: { RequestID: frame.Data.RequestID, Data: { Ack: code } } };
    queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(ack) }));
  }
  close() {
    FakeWebSocket.closed++;
  }
}

function useFakeSocket(mode: Mode) {
  FakeWebSocket.mode = mode;
  FakeWebSocket.sent = [];
  FakeWebSocket.closed = 0;
  Reflect.set(globalThis, "WebSocket", FakeWebSocket);
}

const handle: PrintHandle = {
  transportId: "elegoo",
  printerId: "conveyor-printer-1",
  ref: "a.gcode",
  address: "10.0.0.8",
  deviceId: "mainboard-abc",
};

function withinMs<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${what} did not finish in ${ms} ms`)), ms),
    ),
  ]);
}

describe("elegoo cancel", () => {
  test("sends STOP_PRINT to the mainboard the print was started on", async () => {
    useFakeSocket("ack");
    await elegoo.cancel?.(handle);
    expect(FakeWebSocket.sent).toHaveLength(1);
    const { url, frame } = FakeWebSocket.sent[0];
    expect(url).toBe("ws://10.0.0.8:3030/websocket");
    expect(frame.Data.Cmd).toBe(SDCP_CMD.STOP_PRINT);
    expect(frame.Data.MainboardID).toBe("mainboard-abc");
  });

  test("a socket that closes without an ack is not a confirmed stop", async () => {
    useFakeSocket("close");
    const stop = elegoo.cancel?.(handle) ?? Promise.resolve();
    await expect(stop).rejects.toThrow("closed before the printer acked");
  });
});

describe("elegoo cancel ack codes", () => {
  test("a non-zero ack rejects the stop", async () => {
    useFakeSocket("nack");
    const stop = elegoo.cancel?.(handle) ?? Promise.resolve();
    await expect(stop).rejects.toThrow("rejected (ack 1)");
  });
});

const { preconnect } = globalThis.fetch;
const fetchSpy = spyOn(globalThis, "fetch");

afterAll(() => {
  fetchSpy.mockRestore();
});

describe("elegoo submit", () => {
  test("a cancel during the upload never sends START_PRINT", async () => {
    useFakeSocket("ack");
    const dir = await mkdtemp(join(tmpdir(), "conveyor-elegoo-"));
    const path = join(dir, "a.gcode");
    await writeFile(path, "G28\n");
    const controller = new AbortController();
    const upload = async () => {
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
    const target = { id: "p", transportId: "elegoo", address: "10.0.0.8", secrets: {} };
    const submit = elegoo.submit({ path, format: "gcode" }, target, ctx);
    await expect(submit).rejects.toBeInstanceOf(PrintNotStartedError);
    expect(FakeWebSocket.sent).toHaveLength(0);
  });
});

describe("elegoo handles", () => {
  test("handleFor carries the stored mainboard id", () => {
    const built = elegoo.handleFor?.(
      {
        id: "conveyor-printer-1",
        transportId: "elegoo",
        address: "10.0.0.8",
        secrets: { mainboardId: "mainboard-abc" },
      },
      "a.gcode",
    );
    expect(built?.deviceId).toBe("mainboard-abc");
    expect(built?.address).toBe("10.0.0.8");
  });
});

describe("elegoo status", () => {
  test("the status stream ends when the signal aborts", async () => {
    useFakeSocket("silent");
    const controller = new AbortController();
    const seen: string[] = [];
    const drain = (async () => {
      for await (const s of elegoo.status(handle, controller.signal)) {
        seen.push(s.state);
        setTimeout(() => controller.abort(), 5);
      }
    })();
    await withinMs(drain, 1000, "elegoo status");
    expect(seen).toEqual(["transferring"]);
    expect(FakeWebSocket.closed).toBe(1);
  });
});
