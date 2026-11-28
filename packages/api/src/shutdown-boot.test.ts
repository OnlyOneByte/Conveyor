import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JOB_STREAM_CLOSE } from "@conveyor/shared";
import { z } from "zod";
import { type BootedApi, bootApi, job } from "../test/helpers/booted-api.ts";

const STOPS_WITHIN_MS = 2_000;

async function queuedJob(api: BootedApi): Promise<string> {
  const res = await fetch(`${api.base}/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(job),
  });
  expect(res.status).toBe(202);
  return z.object({ jobId: z.string() }).parse(await res.json()).jobId;
}

describe("the booted api on SIGTERM", () => {
  const dir = mkdtempSync(join(tmpdir(), "conveyor-api-sigterm-"));
  let api: BootedApi;

  beforeEach(async () => {
    api = await bootApi(dir, {
      CONVEYOR_AUTH: "disabled",
      CONVEYOR_QUEUE: "sqlite",
      CONVEYOR_QUEUE_UNSTABLE: "1",
    });
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("closes its job sockets as restarting and exits 0 within 2 s", async () => {
    const jobId = await queuedJob(api);
    const ws = new WebSocket(`${api.base.replace("http", "ws")}/jobs/${jobId}/ws`);
    const closed = new Promise<number>((resolve) =>
      ws.addEventListener("close", (e) => resolve(e.code), { once: true }),
    );
    await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));

    const started = performance.now();
    const code = await api.signal("SIGTERM");
    const tookMs = performance.now() - started;

    expect(code).toBe(0);
    expect(tookMs).toBeLessThan(STOPS_WITHIN_MS);
    expect(await closed).toBe(JOB_STREAM_CLOSE.restarting);
  });

  test("exits 0 within 2 s even when a job socket never answers the close", async () => {
    const jobId = await queuedJob(api);
    const base = new URL(api.base);
    const silent = connect(Number(base.port), base.hostname);
    silent.on("error", () => undefined);
    const upgraded = new Promise<void>((resolve) =>
      silent.on("data", (chunk) => {
        if (String(chunk).startsWith("HTTP/1.1 101")) resolve();
      }),
    );
    silent.write(
      `GET /jobs/${jobId}/ws HTTP/1.1\r\nHost: ${base.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n",
    );
    await upgraded;
    const started = performance.now();
    const code = await api.signal("SIGTERM");
    const tookMs = performance.now() - started;
    silent.destroy();
    expect(code).toBe(0);
    expect(tookMs).toBeLessThan(STOPS_WITHIN_MS);
  });

  test("exits 0 within 2 s with an idle keep-alive connection open", async () => {
    const base = new URL(api.base);
    const idle = connect(Number(base.port), base.hostname);
    idle.on("error", () => undefined);
    const answered = new Promise<void>((resolve) =>
      idle.on("data", (chunk) => {
        if (String(chunk).startsWith("HTTP/1.1 200")) resolve();
      }),
    );
    idle.write(`GET /health HTTP/1.1\r\nHost: ${base.host}\r\nConnection: keep-alive\r\n\r\n`);
    await answered;
    const started = performance.now();
    const code = await api.signal("SIGTERM");
    const tookMs = performance.now() - started;
    idle.destroy();
    expect(code).toBe(0);
    expect(tookMs).toBeLessThan(STOPS_WITHIN_MS);
  });
});
