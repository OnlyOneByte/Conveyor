import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BootedApi, bootApi, login } from "../../test/helpers/booted-api.ts";
import { CROSS_ORIGIN_REFUSED } from "../origin";

const PASSWORD = "origin-test-password";
const dir = mkdtempSync(join(tmpdir(), "conveyor-api-origin-"));
let api: BootedApi;
let cookie = "";

beforeAll(async () => {
  api = await bootApi(dir, {
    CONVEYOR_AUTH: "enabled",
    CONVEYOR_PASSWORD: PASSWORD,
    CONVEYOR_AUTH_SECRET: "origin-test-secret-origin-test-secret",
    CONVEYOR_DOMAIN: "conveyor.example",
  });
  cookie = await login(api.base, PASSWORD);
}, 15_000);

afterAll(async () => {
  await api.stop();
  rmSync(dir, { recursive: true, force: true });
});

const post = (path: string, headers: Record<string, string>) =>
  fetch(`${api.base}${path}`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json", ...headers },
    body: "{}",
  });

async function rawLogout(host: string, origin: string): Promise<string> {
  const { hostname, port } = new URL(api.base);
  const socket = connect(Number(port), hostname);
  let raw = "";
  socket.on("data", (data) => {
    raw += data.toString("latin1");
  });
  const closed = new Promise<void>((resolve) => socket.on("close", () => resolve()));
  await new Promise<void>((resolve) => socket.once("connect", () => resolve()));
  socket.write(
    `POST /auth/logout HTTP/1.1\r\nHost: ${host}\r\nOrigin: ${origin}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`,
  );
  await Promise.race([closed, Bun.sleep(3_000)]);
  socket.destroy();
  return raw.split("\r\n")[0] ?? "";
}

describe("the auth guard's Origin check on a booted api", () => {
  test("refuses a signed-in write from another site with 403", async () => {
    const res = await post("/jobs/j1/dismiss", { origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: CROSS_ORIGIN_REFUSED });
  });

  test("refuses an upload from another site before reading it", async () => {
    const form = new FormData();
    form.append("file", new Blob(["solid x\nendsolid x\n"]), "x.stl");
    const res = await fetch(`${api.base}/uploads`, {
      method: "POST",
      headers: { cookie, origin: "https://other.conveyor.example" },
      body: form,
      keepalive: false,
    });
    expect(res.status).toBe(403);
    expect(res.headers.get("connection")).toBe("close");
  });

  test("refuses a login from another site, so it can't sign the browser in", async () => {
    const res = await fetch(`${api.base}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ password: PASSWORD }),
    });
    expect(res.status).toBe(403);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  test("refuses a write a browser marks cross-site, even with no Origin", async () => {
    expect((await post("/jobs/j1/dismiss", { "sec-fetch-site": "cross-site" })).status).toBe(403);
  });

  test("lets a signed-in write from its own origin reach the route", async () => {
    const own = await post("/jobs/j1/dismiss", {
      origin: api.base,
      "sec-fetch-site": "same-origin",
    });
    expect(own.status).not.toBe(403);
    expect(own.status).not.toBe(401);
  });

  test("lets a client with no Origin through to the session check", async () => {
    expect((await post("/jobs/j1/dismiss", {})).status).not.toBe(403);
    const signedOut = await fetch(`${api.base}/jobs/j1/dismiss`, { method: "POST" });
    expect(signedOut.status).toBe(401);
  });

  test("compares against the Host Caddy passes through, not the api's own address", async () => {
    expect(await rawLogout("conveyor.example", "https://conveyor.example")).toBe("HTTP/1.1 200 OK");
    expect(await rawLogout("localhost:5173", "http://localhost:5173")).toBe("HTTP/1.1 200 OK");
    expect(await rawLogout("conveyor.example", "https://evil.example")).toBe(
      "HTTP/1.1 403 Forbidden",
    );
  });

  test("never refuses a read from another site", async () => {
    const res = await fetch(`${api.base}/auth/status`, {
      headers: { origin: "https://evil.example" },
    });
    expect(res.status).toBe(200);
  });
});
