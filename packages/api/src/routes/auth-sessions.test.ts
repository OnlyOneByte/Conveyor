import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BootedApi, bootApi, login } from "../../test/booted-api.ts";
import { rawGet } from "../../test/raw-http.ts";

const dir = mkdtempSync(join(tmpdir(), "conveyor-api-sessions-"));
const PASSWORD = "sessions-test-password";
const env = (password: string) => ({
  CONVEYOR_QUEUE: "sqlite",
  CONVEYOR_QUEUE_UNSTABLE: "1",
  CONVEYOR_AUTH: "enabled",
  CONVEYOR_PASSWORD: password,
  CONVEYOR_AUTH_SECRET: "sessions-test-secret-sessions-test-secret",
});
let api: BootedApi | undefined;

afterAll(async () => {
  await api?.stop();
  rmSync(dir, { recursive: true, force: true });
});

async function boot(password: string): Promise<string> {
  await api?.stop();
  api = await bootApi(dir, env(password));
  return api.base;
}

const status = async (base: string, cookie: string) =>
  (await fetch(`${base}/catalog/printers`, { headers: { cookie } })).status;

const logout = (base: string, cookie: string) =>
  fetch(`${base}/auth/logout`, { method: "POST", headers: { cookie } });

describe("sessions", () => {
  test("logout revokes that session on the server, and only that one", async () => {
    const base = await boot(PASSWORD);
    const first = await login(base, PASSWORD);
    const second = await login(base, PASSWORD);
    expect([await status(base, first), await status(base, second)]).toEqual([200, 200]);
    expect((await logout(base, first)).status).toBe(200);
    expect([await status(base, first), await status(base, second)]).toEqual([401, 200]);
  });

  test("a session survives a restart with the same password", async () => {
    const base = await boot(PASSWORD);
    const cookie = await login(base, PASSWORD);
    const again = await boot(PASSWORD);
    expect(await status(again, cookie)).toBe(200);
  });

  test("changing the password revokes every existing session", async () => {
    const base = await boot(PASSWORD);
    const cookie = await login(base, PASSWORD);
    const changed = await boot("a-new-sessions-test-password");
    expect(await status(changed, cookie)).toBe(401);
    const fresh = await login(changed, "a-new-sessions-test-password");
    expect(await status(changed, fresh)).toBe(200);
  });

  test("a forged or tampered cookie is refused and logging it out is harmless", async () => {
    const base = await boot(PASSWORD);
    const cookie = await login(base, PASSWORD);
    const tampered = `${cookie.slice(0, -2)}xx`;
    expect(await status(base, tampered)).toBe(401);
    expect((await logout(base, tampered)).status).toBe(200);
    expect(await status(base, cookie)).toBe(200);
  });

  test("API responses carry the security headers", async () => {
    const base = await boot(PASSWORD);
    const res = await fetch(`${base}/health`);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    const bad = await rawGet(Number(new URL(base).port), "/jobs/%E0%A4%A");
    expect([bad.status, bad.headers["x-content-type-options"], JSON.parse(bad.body)]).toEqual([
      400,
      "nosniff",
      { error: "bad request" },
    ]);
  });
});
