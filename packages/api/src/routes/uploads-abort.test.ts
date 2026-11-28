import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import multipart from "@fastify/multipart";
import Fastify, { type FastifyInstance } from "fastify";
import { registerUploadRoutes, type UploadRoutes } from "./uploads.js";

const SLACK = { idleMs: 30_000, deadlineMs: 600_000 };
const HEAD = Buffer.from(
  '--B\r\nContent-Disposition: form-data; name="file"; filename="x.stl"\r\nContent-Type: application/octet-stream\r\n\r\n',
);
let app: FastifyInstance | undefined;
let dir = "";
const logs: string[] = [];

afterEach(async () => {
  app?.server.closeAllConnections();
  await app?.close();
  app = undefined;
  rmSync(dir, { recursive: true, force: true });
  logs.length = 0;
});

async function serve(folderMaxBytes?: number): Promise<{ base: string; routes: UploadRoutes }> {
  dir = mkdtempSync(join(tmpdir(), "conveyor-api-uploads-abort-"));
  app = Fastify({
    logger: { level: "info", stream: { write: (line: string) => logs.push(line) } },
  });
  await app.register(multipart, { limits: { fileSize: 1 << 20 } });
  const routes = await registerUploadRoutes(app, {
    dir,
    maxBytes: 1 << 20,
    folderMaxBytes,
    ...SLACK,
  });
  return { base: await app.listen({ host: "127.0.0.1", port: 0 }), routes };
}

function stl(facets: number): Uint8Array {
  const bytes = new Uint8Array(84 + 50 * facets);
  new DataView(bytes.buffer).setUint32(80, facets, true);
  return bytes;
}

async function until(what: string, ready: () => boolean, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!ready()) {
    if (Date.now() > deadline) throw new Error(`${what} not reached within ${ms} ms`);
    await Bun.sleep(5);
  }
}

async function startUpload(base: string, sent: Uint8Array): Promise<Socket> {
  const { hostname, port } = new URL(base);
  const socket = connect(Number(port), hostname);
  socket.on("error", () => undefined);
  await new Promise<void>((resolve) => socket.once("connect", () => resolve()));
  socket.write(
    `POST /uploads HTTP/1.1\r\nHost: ${hostname}:${port}\r\nContent-Type: multipart/form-data; boundary=B\r\nContent-Length: 100000\r\n\r\n`,
  );
  socket.write(Buffer.concat([HEAD, sent]));
  return socket;
}

const parts = () => readdirSync(dir).filter((name) => name.endsWith(".part"));

function upload(base: string, content: Uint8Array): Promise<Response> {
  const form = new FormData();
  form.append("file", new Blob([content]), "part.stl");
  return fetch(`${base}/uploads`, { method: "POST", body: form, keepalive: false });
}

describe("an upload whose client drops the connection", () => {
  test.each([
    ["with no folder cap", undefined],
    ["under a folder cap", 50 * 2000],
  ])("settles its handler, %s, for 50 dropped at once", async (_label, cap) => {
    const { base, routes } = await serve(cap);
    const sockets = await Promise.all(
      Array.from({ length: 50 }, () => startUpload(base, stl(30).subarray(0, 1500))),
    );
    await until("all 50 uploads writing", () => parts().length === 50);
    for (const socket of sockets) socket.destroy();
    await until("every dropped handler to settle", () => routes.pending() === 0);
    expect(routes.inFlight()).toBe(0);
    expect(logs.filter((line) => line.includes("aborted by the client"))).toHaveLength(50);
    expect(parts()).toEqual([]);
    expect((await upload(base, stl(30))).status).toBe(201);
    expect(routes.pending()).toBe(0);
    expect(logs.filter((line) => line.includes("aborted by the client"))).toHaveLength(50);
  });
});
