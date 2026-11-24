import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { job, jobRows, login } from "../../test/booted-api.ts";

const dir = mkdtempSync(join(tmpdir(), "conveyor-api-guard-sqlite-"));
const { REDIS_URL: _redis, ...inherited } = process.env;
const api = Bun.spawn([process.execPath, join(import.meta.dir, "..", "index.ts")], {
  cwd: dir,
  env: {
    ...inherited,
    CONVEYOR_QUEUE: "sqlite",
    CONVEYOR_QUEUE_UNSTABLE: "1",
    CONVEYOR_AUTH: "enabled",
    CONVEYOR_PASSWORD: "guard-test-password",
    CONVEYOR_AUTH_SECRET: "guard-test-secret-guard-test-secret!",
    CONVEYOR_HOST: "127.0.0.1",
    PORT: "0",
    DB_PATH: join(dir, "conveyor.db"),
    DATA_DIR: dir,
  },
  stdout: "pipe",
  stderr: "ignore",
});
let base = "";

async function drain(reader: { read(): Promise<{ done: boolean }> }): Promise<void> {
  while (!(await reader.read()).done) {}
}

async function listeningUrl(): Promise<string> {
  const reader = api.stdout.getReader();
  const decoder = new TextDecoder();
  let seen = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`api exited before listening: ${seen}`);
    seen += decoder.decode(value);
    const match = seen.match(/listening at (http:\/\/127\.0\.0\.1:\d+)/);
    if (match?.[1]) {
      void drain(reader);
      return match[1];
    }
  }
}

beforeAll(async () => {
  base = await listeningUrl();
}, 15_000);

afterAll(async () => {
  api.kill();
  await api.exited;
  rmSync(dir, { recursive: true, force: true });
});

describe("the auth guard on an api running the sqlite queue", () => {
  test("serves the sqlite job routes to a session, with Redis unreachable", async () => {
    const cookie = await login(base, "guard-test-password");
    const active = await fetch(`${base}/jobs/active`, { headers: { cookie } });
    expect([active.status, await active.json()]).toEqual([200, []]);
    const posted = await fetch(`${base}/jobs`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(job),
    });
    expect(posted.status).toBe(202);
    expect(jobRows(dir)).toBe(1);
  });

  test.each([
    ["POST", "/jobs"],
    ["GET", "/jobs/active"],
    ["GET", "/jobs/j1"],
    ["GET", "/jobs/j1/artifact/model"],
    ["POST", "/jobs/j1/cancel"],
    ["POST", "/jobs/j1/dismiss"],
    ["GET", "/jobs/needs-you"],
    ["GET", "/jobs/j1/ws"],
    ["GET", "/jobs-history"],
    ["GET", "/jobs-history/j1"],
  ])("refuses %s %s without a session", async (method, path) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: method === "GET" ? undefined : "{}",
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "authentication required" });
  });

  test("refuses the websocket upgrade without a session", async () => {
    const response = await fetch(`${base}/jobs/j1/ws`, {
      headers: {
        connection: "Upgrade",
        upgrade: "websocket",
        "sec-websocket-version": "13",
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
      },
    });
    expect(response.status).toBe(401);
  });
});
