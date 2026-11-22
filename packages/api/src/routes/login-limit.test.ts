import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BootedApi, bootApi } from "../../test/booted-api.ts";

const dir = mkdtempSync(join(tmpdir(), "conveyor-api-login-limit-"));
const password = "limit-test-password";
let api: BootedApi;

beforeAll(async () => {
  api = await bootApi(dir, {
    CONVEYOR_AUTH: "enabled",
    CONVEYOR_PASSWORD: password,
    CONVEYOR_AUTH_SECRET: "limit-test-secret-limit-test-secret!",
  });
}, 15_000);

afterAll(async () => {
  await api.stop();
  rmSync(dir, { recursive: true, force: true });
});

const login = (attempt: string) =>
  fetch(`${api.base}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: attempt }),
  });

describe("POST /auth/login on a booted api", () => {
  test("answers 429 with Retry-After after five failed logins, even for the right password", async () => {
    expect((await login(password)).status).toBe(200);
    for (let i = 0; i < 5; i++) expect((await login("wrong-guess")).status).toBe(401);
    const blocked = await login(password);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await blocked.json()).toEqual({ error: "too many failed logins; try again later" });
  });
});
