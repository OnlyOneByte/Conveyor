import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BootedApi, bootApi, login } from "../test/helpers/booted-api.ts";

const PASSWORD = "a-long-test-passphrase";
const dir = mkdtempSync(join(tmpdir(), "conveyor-health-"));
let api: BootedApi;

beforeAll(async () => {
  api = await bootApi(dir, {
    CONVEYOR_QUEUE: "sqlite",
    CONVEYOR_QUEUE_UNSTABLE: "1",
    CONVEYOR_PASSWORD: PASSWORD,
    CONVEYOR_AUTH_SECRET: "x".repeat(32),
  });
});
afterAll(async () => {
  await api.stop();
  rmSync(dir, { recursive: true, force: true });
});

test("the liveness probe stays public and cheap", async () => {
  const res = await fetch(`${api.base}/health`);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});

test("the deep report needs a signed-in session", async () => {
  expect((await fetch(`${api.base}/health/deep`)).status).toBe(401);
});

test("signed in, the deep report shows the database up and no worker yet", async () => {
  const cookie = await login(api.base, PASSWORD);
  const res = await fetch(`${api.base}/health/deep`, { headers: { cookie } });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    status: "degraded",
    db: "ok",
    worker: { state: "missing" },
    engines: {},
  });
});
