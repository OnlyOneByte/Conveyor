import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BootedApi, bootApi } from "../../test/helpers/booted-api.ts";

const password = "limit-test-password";
const stops: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
});

async function boot(env: Record<string, string> = {}): Promise<BootedApi> {
  const dir = mkdtempSync(join(tmpdir(), "conveyor-api-login-limit-"));
  stops.push(async () => rmSync(dir, { recursive: true, force: true }));
  const api = await bootApi(dir, {
    CONVEYOR_AUTH: "enabled",
    CONVEYOR_PASSWORD: password,
    CONVEYOR_AUTH_SECRET: "limit-test-secret-limit-test-secret!",
    ...env,
  });
  stops.unshift(api.stop);
  return api;
}

function login(api: BootedApi, attempt: string, forwardedFor?: string) {
  return fetch(`${api.base}/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(forwardedFor ? { "x-forwarded-for": forwardedFor } : {}),
    },
    body: JSON.stringify({ password: attempt }),
  });
}

async function statuses(api: BootedApi, attempts: [string, string?][]): Promise<number[]> {
  const out: number[] = [];
  for (const [attempt, xff] of attempts) out.push((await login(api, attempt, xff)).status);
  return out;
}

const wrong = (n: number, xff?: (i: number) => string): [string, string?][] =>
  Array.from({ length: n }, (_, i) => ["wrong-guess", xff?.(i)]);

describe("POST /auth/login's failure limit on a booted api", () => {
  test("clears on success, then answers 429 with Retry-After after five failures, right password too", async () => {
    const api = await boot();
    expect(await statuses(api, [...wrong(4), [password], ...wrong(5)])).toEqual([
      401, 401, 401, 401, 200, 401, 401, 401, 401, 401,
    ]);
    const blocked = await login(api, password);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await blocked.json()).toEqual({ error: "too many failed logins; try again later" });
  }, 15_000);

  for (const [name, env] of [
    ["with no trusted proxy", {}],
    ["when the trusted proxy is another host", { CONVEYOR_TRUSTED_PROXIES: "10.9.9.9" }],
  ] as const) {
    test(`ignores a forged X-Forwarded-For ${name}`, async () => {
      const api = await boot(env);
      await statuses(
        api,
        wrong(5, (i) => `198.51.100.${i + 1}`),
      );
      expect((await login(api, password, "198.51.100.99")).status).toBe(429);
    }, 15_000);
  }

  test("gives each client behind a trusted proxy its own budget, and an IPv6 /64 one", async () => {
    const api = await boot({ CONVEYOR_TRUSTED_PROXIES: "127.0.0.1,::1" });
    await statuses(
      api,
      wrong(5, () => "203.0.113.1"),
    );
    expect((await login(api, password, "203.0.113.1")).status).toBe(429);
    expect((await login(api, password, "203.0.113.2")).status).toBe(200);
    await statuses(
      api,
      wrong(5, () => "2001:db8:1:2::1"),
    );
    expect((await login(api, password, "2001:db8:1:2::abcd")).status).toBe(429);
    expect((await login(api, password, "2001:db8:1:3::1")).status).toBe(200);
  }, 15_000);

  test("refuses to start with an invalid CONVEYOR_TRUSTED_PROXIES", async () => {
    await expect(boot({ CONVEYOR_TRUSTED_PROXIES: "10.0.0.0/33" })).rejects.toThrow(
      "api exited before listening",
    );
  }, 15_000);
});
