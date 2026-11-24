import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BootedApi, bootApi, job } from "../../test/booted-api.ts";

const ANSWER_WITHIN_MS = 5_000;

describe("the api on the Redis queue with Redis down", () => {
  const dir = mkdtempSync(join(tmpdir(), "conveyor-redis-down-"));
  let api: BootedApi;

  beforeAll(async () => {
    api = await bootApi(dir, { CONVEYOR_AUTH: "disabled", REDIS_URL: "redis://127.0.0.1:1" });
  });

  afterAll(async () => {
    await api.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  const answer = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${api.base}${path}`, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(ANSWER_WITHIN_MS),
    });
    return { status: res.status, body: await res.text() };
  };

  const unavailable = { status: 503, body: JSON.stringify({ error: "queue unavailable" }) };

  test("refuses a new job with a 503 instead of hanging", async () => {
    expect(await answer("POST", "/jobs", job)).toEqual(unavailable);
  });

  test("answers the job reads and a cancel with a 503", async () => {
    const id = randomUUID();
    expect(await answer("GET", "/jobs/active")).toEqual(unavailable);
    expect(await answer("GET", `/jobs/${id}`)).toEqual(unavailable);
    expect(await answer("POST", `/jobs/${id}/cancel`)).toEqual(unavailable);
  });

  test("answers deleting a printer with a 503 rather than deleting it unchecked", async () => {
    expect(await answer("DELETE", "/catalog/printers/klipper-garage")).toEqual(unavailable);
    const printers = await answer("GET", "/catalog/printers");
    expect(printers.body).toContain("klipper-garage");
  });
});
