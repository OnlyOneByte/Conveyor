import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JOB_STREAM_CLOSE } from "@conveyor/shared";
import { z } from "zod";
import { type BootedApi, bootApi, job } from "../test/booted-api.ts";

const STOPS_WITHIN_MS = 2_000;

describe("the booted api on SIGTERM", () => {
  const dir = mkdtempSync(join(tmpdir(), "conveyor-api-sigterm-"));
  let api: BootedApi;

  beforeAll(async () => {
    api = await bootApi(dir, {
      CONVEYOR_AUTH: "disabled",
      CONVEYOR_QUEUE: "sqlite",
      CONVEYOR_QUEUE_UNSTABLE: "1",
    });
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("closes its job sockets as restarting and exits 0 within 2 s", async () => {
    const res = await fetch(`${api.base}/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(job),
    });
    expect(res.status).toBe(202);
    const { jobId } = z.object({ jobId: z.string() }).parse(await res.json());
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
});
