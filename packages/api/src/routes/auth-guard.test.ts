import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authStatusSchema } from "@conveyor/shared/auth-status";
import { job, jobRows, login } from "../../test/helpers/booted-api.ts";

const dir = mkdtempSync(join(tmpdir(), "conveyor-api-guard-"));
const api = Bun.spawn([process.execPath, join(import.meta.dir, "..", "index.ts")], {
  env: {
    ...process.env,
    CONVEYOR_AUTH: "enabled",
    CONVEYOR_PASSWORD: "guard-test-password",
    CONVEYOR_AUTH_SECRET: "guard-test-secret-guard-test-secret!",
    CONVEYOR_HOST: "127.0.0.1",
    PORT: "0",
    DB_PATH: join(dir, "conveyor.db"),
    DATA_DIR: dir,
    REDIS_URL: "redis://127.0.0.1:1",
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

afterAll(() => {
  api.kill();
  rmSync(dir, { recursive: true, force: true });
});

const send = (method: string, path: string) =>
  fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: method === "GET" ? undefined : "{}",
  });

describe("the global auth guard on a booted api", () => {
  test("keeps the Redis job routes by default, so a submitted job lands no sqlite row", async () => {
    const cookie = await login(base, "guard-test-password");
    await fetch(`${base}/jobs`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(job),
      signal: AbortSignal.timeout(500),
    }).catch(() => undefined);
    expect(jobRows(dir)).toBe(0);
  });

  test.each([
    ["POST", "/catalog/printers/p1/release"],
    ["POST", "/jobs"],
    ["POST", "/jobs/j1/cancel"],
    ["POST", "/jobs/j1/dismiss"],
    ["POST", "/catalog/printers/p1/release"],
    ["GET", "/jobs/needs-you"],
    ["POST", "/uploads"],
    ["PUT", "/catalog/printers"],
    ["DELETE", "/catalog/printers/p1"],
    ["PUT", "/catalog/profiles"],
    ["PUT", "/catalog/profiles/x/content"],
    ["DELETE", "/catalog/profiles/x/content"],
    ["DELETE", "/catalog/profiles/x"],
    ["GET", "/health/deep"],
  ])("refuses %s %s without a session", async (method, path) => {
    const response = await send(method, path);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "authentication required" });
  });

  test("opens only the routes that opt in, not paths that merely look like them", async () => {
    expect((await send("GET", "/health")).status).toBe(200);
    expect((await send("GET", "/auth/status")).status).toBe(200);
    expect((await send("GET", "/health-report")).status).toBe(401);
    expect((await send("GET", "/healthz")).status).toBe(401);
    expect((await send("GET", "/authx")).status).toBe(401);
    expect((await send("GET", "/auth-foo")).status).toBe(401);
  });

  test("answers /auth/status in the shared schema, signed out and signed in", async () => {
    const out = authStatusSchema.parse(await (await send("GET", "/auth/status")).json());
    expect(out).toEqual({ authEnabled: true, authenticated: false });
    const cookie = await login(base, "guard-test-password");
    const signed = await fetch(`${base}/auth/status`, { headers: { cookie } });
    expect(authStatusSchema.parse(await signed.json())).toEqual({
      authEnabled: true,
      authenticated: true,
    });
  });

  test("matches the route without its query string, so a query can neither open nor close one", async () => {
    expect((await send("GET", "/jobs?/health")).status).toBe(401);
    expect((await send("POST", "/jobs?x=/auth/login")).status).toBe(401);
    expect((await send("GET", "/health?probe=1")).status).toBe(200);
  });
});

async function slowUnauthenticatedUpload(): Promise<{ head: string; closedMs: number | null }> {
  const { hostname, port } = new URL(base);
  const socket = connect(Number(port), hostname);
  socket.on("error", () => undefined);
  let raw = "";
  let closedMs: number | null = null;
  const started = Date.now();
  socket.on("data", (data) => {
    raw += data.toString("latin1");
  });
  const closed = new Promise<void>((resolve) =>
    socket.on("close", () => {
      closedMs = Date.now() - started;
      resolve();
    }),
  );
  await new Promise<void>((resolve) => socket.once("connect", () => resolve()));
  socket.write(
    `POST /uploads HTTP/1.1\r\nHost: ${hostname}\r\nContent-Type: multipart/form-data; boundary=B\r\nContent-Length: 100000\r\n\r\n--B\r\n`,
  );
  const trickle = setInterval(() => socket.write("x"), 100);
  await Promise.race([closed, Bun.sleep(3_000)]);
  clearInterval(trickle);
  socket.destroy();
  return { head: raw.split("\r\n\r\n")[0]?.toLowerCase() ?? "", closedMs };
}

describe("the auth guard and a request body", () => {
  test("a slow unauthenticated upload gets its 401 and then loses its connection", async () => {
    const { head, closedMs } = await slowUnauthenticatedUpload();
    expect(head).toStartWith("http/1.1 401");
    expect(head).toContain("connection: close");
    expect(closedMs).not.toBeNull();
    expect(closedMs ?? Number.POSITIVE_INFINITY).toBeLessThan(2_500);
  });

  test("a 401 for a complete small body keeps the connection open for the next request", async () => {
    for (let i = 0; i < 5; i++) {
      const response = await send("POST", "/jobs");
      expect(response.status).toBe(401);
      expect(response.headers.get("connection")).not.toBe("close");
    }
  });
});
