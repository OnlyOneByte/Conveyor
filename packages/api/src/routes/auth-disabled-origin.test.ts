import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BootedApi, bootApi } from "../../test/helpers/booted-api.ts";
import { CROSS_ORIGIN_REFUSED } from "../origin";

const dir = mkdtempSync(join(tmpdir(), "conveyor-api-open-origin-"));
let api: BootedApi;

beforeAll(async () => {
  api = await bootApi(dir, { CONVEYOR_AUTH: "disabled" });
}, 15_000);

afterAll(async () => {
  await api.stop();
  rmSync(dir, { recursive: true, force: true });
});

const post = (path: string, headers: Record<string, string>) =>
  fetch(`${api.base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: "{}",
  });

async function rawDismiss(host: string, origin: string): Promise<string> {
  const { hostname, port } = new URL(api.base);
  const socket = connect(Number(port), hostname);
  let raw = "";
  socket.on("data", (data) => {
    raw += data.toString("latin1");
  });
  const closed = new Promise<void>((resolve) => socket.on("close", () => resolve()));
  await new Promise<void>((resolve) => socket.once("connect", () => resolve()));
  socket.write(
    `POST /jobs/j1/dismiss HTTP/1.1\r\nHost: ${host}\r\nOrigin: ${origin}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`,
  );
  await Promise.race([closed, Bun.sleep(3_000)]);
  socket.destroy();
  return raw.split("\r\n")[0] ?? "";
}

describe("the Origin check with CONVEYOR_AUTH=disabled", () => {
  test("refuses a cross-site write with 403, though no login is needed", async () => {
    const res = await post("/jobs/j1/dismiss", { origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: CROSS_ORIGIN_REFUSED });
  });

  test("refuses a cross-site upload and closes its connection", async () => {
    const form = new FormData();
    form.append("file", new Blob(["solid x\nendsolid x\n"]), "x.stl");
    const res = await fetch(`${api.base}/uploads`, {
      method: "POST",
      headers: { origin: "https://other.conveyor.example" },
      body: form,
      keepalive: false,
    });
    expect(res.status).toBe(403);
    expect(res.headers.get("connection")).toBe("close");
  });

  test("refuses a write a browser marks cross-site, even with no Origin", async () => {
    expect((await post("/jobs/j1/dismiss", { "sec-fetch-site": "cross-site" })).status).toBe(403);
  });

  test("lets a same-origin write through to the route", async () => {
    const own = await post("/jobs/j1/dismiss", {
      origin: api.base,
      "sec-fetch-site": "same-origin",
    });
    expect(own.status).not.toBe(403);
    expect(await own.json()).not.toEqual({ error: CROSS_ORIGIN_REFUSED });
  });

  test("lets a client with no Origin through", async () => {
    expect((await post("/jobs/j1/dismiss", {})).status).not.toBe(403);
  });

  test("matches the Host behind Caddy and in dev, and refuses a foreign Origin there", async () => {
    expect(await rawDismiss("conveyor.example", "https://conveyor.example")).not.toContain("403");
    expect(await rawDismiss("localhost:5173", "http://localhost:5173")).not.toContain("403");
    expect(await rawDismiss("conveyor.example", "https://evil.example")).toBe(
      "HTTP/1.1 403 Forbidden",
    );
  });
});
