import { afterEach, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { StageCtx } from "@conveyor/shared";
import { tempDirs } from "../../../../packages/shared/test/helpers/index.ts";
import { elegoo } from "./index.ts";

const tempDir = tempDirs("conveyor-elegoo-redirect-");

const RealWebSocket = globalThis.WebSocket;
const IDLE_PUSH = JSON.stringify({
  Topic: "sdcp/status/mb",
  Data: { Status: { CurrentStatus: [0], PrintInfo: { Status: 0 } } },
});

class IdleSocket {
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {
    queueMicrotask(() => this.onopen?.());
  }
  send() {
    queueMicrotask(() => this.onmessage?.({ data: IDLE_PUSH }));
  }
  close() {}
}

const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  Reflect.set(globalThis, "WebSocket", RealWebSocket);
});

test("an upload the printer redirects is refused, never followed", async () => {
  Reflect.set(globalThis, "WebSocket", IdleSocket);
  let followed = 0;
  const target = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      followed++;
      return new Response("ok");
    },
  });
  const printer = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      await req.arrayBuffer();
      return Response.redirect(`http://127.0.0.1:${target.port}/uploadFile/upload`, 302);
    },
  });
  stops.push(
    () => printer.stop(true),
    () => target.stop(true),
  );
  const dir = await tempDir();
  const path = join(dir, "a.gcode");
  await writeFile(path, "G28\n");
  const ctx: StageCtx = {
    jobId: "j",
    workDir: dir,
    signal: new AbortController().signal,
    report: () => {},
    log: () => {},
  };
  const printerTarget = {
    id: "e1",
    transportId: "elegoo",
    address: `127.0.0.1:${printer.port}`,
    secrets: {},
  };
  await expect(elegoo.submit({ path, format: "gcode" }, printerTarget, ctx)).rejects.toThrow(
    "elegoo upload was redirected (302)",
  );
  expect(followed).toBe(0);
});
