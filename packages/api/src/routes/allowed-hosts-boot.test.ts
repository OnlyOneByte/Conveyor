import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BootedApi, bootApi } from "../../test/helpers/booted-api.ts";

const JOB_WS = "/jobs/0b3f6c1e-6a4d-4c3e-9f1a-2d5e7b8c9a01/ws";
const COMPOSE_ENV = { CONVEYOR_DOMAIN: "conveyor.example" };
const MODES = {
  "auth on": {
    CONVEYOR_AUTH: "enabled",
    CONVEYOR_PASSWORD: "hosts-test-password",
    CONVEYOR_AUTH_SECRET: "hosts-test-secret-hosts-test-secret!!",
  },
  "auth off": { CONVEYOR_AUTH: "disabled" },
};
const dirs: string[] = [];
const apis: Partial<Record<keyof typeof MODES, BootedApi>> = {};

beforeAll(async () => {
  for (const [mode, env] of Object.entries(MODES)) {
    const dir = mkdtempSync(join(tmpdir(), "conveyor-api-hosts-"));
    dirs.push(dir);
    apis[mode === "auth on" ? "auth on" : "auth off"] = await bootApi(dir, {
      ...COMPOSE_ENV,
      ...env,
    });
  }
}, 20_000);

afterAll(async () => {
  for (const api of Object.values(apis)) await api?.stop();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

async function statusLine(api: BootedApi | undefined, head: string[]): Promise<string> {
  if (!api) throw new Error("api not booted");
  const { hostname, port } = new URL(api.base);
  const socket = connect(Number(port), hostname);
  let raw = "";
  socket.on("data", (data) => {
    raw += data.toString("latin1");
  });
  const closed = new Promise<void>((resolve) => socket.on("close", () => resolve()));
  await new Promise<void>((resolve) => socket.once("connect", () => resolve()));
  socket.write(`${head.join("\r\n")}\r\n\r\n`);
  const answered = async () => {
    while (!raw.includes("\r\n")) await Bun.sleep(2);
  };
  await Promise.race([closed, answered(), Bun.sleep(3_000)]);
  socket.destroy();
  return raw.split("\r\n")[0] ?? "";
}

const get = (path: string, host: string) => [`GET ${path} HTTP/1.1`, `Host: ${host}`];
const upgrade = (host: string, origin: string) => [
  ...get(JOB_WS, host),
  `Origin: ${origin}`,
  "Connection: Upgrade",
  "Upgrade: websocket",
  "Sec-WebSocket-Version: 13",
  "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
];

describe.each(Object.keys(MODES))("the API's Host allowlist, %s", (mode) => {
  const api = () => apis[mode === "auth on" ? "auth on" : "auth off"];

  test.each([
    ["a rebound name", "evil.example"],
    ["a rebound name with the API's port", "evil.example:3000"],
    ["the any-address", "0.0.0.0:3000"],
    ["an IPv6 address not listed", "[::2]:3000"],
  ])("answers %s (%p) with 421, even on /health", async (_label, host) => {
    expect(await statusLine(api(), get("/health", host))).toBe("HTTP/1.1 421 Misdirected Request");
  });

  test.each([
    ["the Compose domain behind Caddy", "conveyor.example"],
    ["the domain with a port suffix", "conveyor.example:443"],
    ["the Compose healthcheck", "127.0.0.1:3000"],
    ["the dev server", "localhost:5173"],
    ["IPv6 loopback", "[::1]:3000"],
  ])("serves %s (%p)", async (_label, host) => {
    expect(await statusLine(api(), get("/health", host))).toBe("HTTP/1.1 200 OK");
  });

  test("refuses a WebSocket upgrade from another site with 403", async () => {
    const line = await statusLine(api(), upgrade("conveyor.example", "https://evil.example"));
    expect(line).toBe("HTTP/1.1 403 Forbidden");
  });

  test("refuses a WebSocket upgrade to a rebound name with 421", async () => {
    const line = await statusLine(api(), upgrade("evil.example", "http://evil.example"));
    expect(line).toBe("HTTP/1.1 421 Misdirected Request");
  });

  test("passes a same-origin WebSocket upgrade on to the session check", async () => {
    const line = await statusLine(api(), upgrade("localhost:5173", "http://localhost:5173"));
    expect(line).toBe(
      mode === "auth on" ? "HTTP/1.1 401 Unauthorized" : "HTTP/1.1 101 Switching Protocols",
    );
  });
});
