import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { open } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import multipart from "@fastify/multipart";
import Fastify, { type FastifyInstance } from "fastify";
import { registerUploadRoutes, streamTo, type Write } from "./uploads.js";

const SLACK = { idleMs: 30_000, deadlineMs: 600_000 };
const CAP = 3200;
const UUID = "0b3f6c1e-6a4d-4c3e-9f1a-2d5e7b8c9a01";
let app: FastifyInstance | undefined;
let dir = "";

afterEach(async () => {
  app?.server.closeAllConnections();
  await app?.close();
  app = undefined;
  rmSync(dir, { recursive: true, force: true });
});

async function serve(write: Write): Promise<string> {
  dir = mkdtempSync(join(tmpdir(), "conveyor-api-uploads-peak-"));
  app = Fastify();
  await app.register(multipart, { limits: { fileSize: 8192 } });
  await registerUploadRoutes(app, { dir, maxBytes: 8192, folderMaxBytes: CAP, ...SLACK }, write);
  return app.listen({ host: "127.0.0.1", port: 0 });
}

function stl(facets: number): Uint8Array {
  const bytes = new Uint8Array(84 + 50 * facets);
  new DataView(bytes.buffer).setUint32(80, facets, true);
  return bytes;
}

function upload(base: string, content: Uint8Array): Promise<Response> {
  const form = new FormData();
  form.append("file", new Blob([content]), "part.stl");
  return fetch(`${base}/uploads`, { method: "POST", body: form, keepalive: false });
}

function onDisk(): number {
  let total = 0;
  for (const name of readdirSync(dir)) {
    try {
      total += statSync(join(dir, name)).size;
    } catch {}
  }
  return total;
}

async function until(what: string, ready: () => boolean, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!ready()) {
    if (Date.now() > deadline) throw new Error(`${what} not reached within ${ms} ms`);
    await Bun.sleep(5);
  }
}

const HEAD = Buffer.from(
  '--B\r\nContent-Disposition: form-data; name="file"; filename="x.stl"\r\nContent-Type: application/octet-stream\r\n\r\n',
);
const TAIL = Buffer.from("\r\n--B--\r\n");

async function rawUpload(base: string, content: Uint8Array, first: number) {
  const { hostname, port } = new URL(base);
  const socket = connect(Number(port), hostname);
  socket.on("error", () => undefined);
  let answer = "";
  socket.on("data", (data) => {
    answer += data.toString("latin1");
  });
  await new Promise<void>((resolve) => socket.once("connect", () => resolve()));
  const length = HEAD.byteLength + content.byteLength + TAIL.byteLength;
  socket.write(
    `POST /uploads HTTP/1.1\r\nHost: ${hostname}:${port}\r\nContent-Type: multipart/form-data; boundary=B\r\nContent-Length: ${length}\r\n\r\n`,
  );
  socket.write(Buffer.concat([HEAD, content.subarray(0, first)]));
  return {
    socket,
    async finish(): Promise<string> {
      socket.write(Buffer.concat([content.subarray(first), TAIL]));
      await until("the upload's answer", () => answer.includes("\r\n"));
      socket.destroy();
      return answer.split("\r\n")[0] ?? "";
    },
  };
}

const partBytes = () =>
  readdirSync(dir)
    .filter((name) => name.endsWith(".part"))
    .reduce((total, name) => total + statSync(join(dir, name)).size, 0);

describe("the uploads folder cap under concurrent uploads", () => {
  test("never lets stored files plus parts in progress pass the cap on disk", async () => {
    let peak = 0;
    const sampled: Write = async (path, source) => {
      const file = await open(path, "w");
      try {
        for await (const chunk of source) {
          await file.write(chunk);
          peak = Math.max(peak, onDisk());
          await Bun.sleep(5);
        }
        await Bun.sleep(30);
        peak = Math.max(peak, onDisk());
      } finally {
        await file.close();
      }
    };
    const base = await serve(sampled);
    const results = await Promise.all(Array.from({ length: 4 }, () => upload(base, stl(60))));
    expect(results.map((res) => res.status).sort()).toEqual([201, 507, 507, 507]);
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(CAP);
    expect(onDisk()).toBeLessThanOrEqual(CAP);
  });

  test("a client that drops its upload gives its reserved bytes back", async () => {
    const base = await serve(streamTo);
    const dropped = await rawUpload(base, stl(60), 2000);
    await until("the dropped upload's bytes on disk", () => partBytes() >= 1000);
    dropped.socket.destroy();
    await until("the dropped upload's part removed", () => partBytes() === 0);
    let status = 0;
    for (let i = 0; i < 20 && status !== 201; i++) {
      status = (await upload(base, stl(60))).status;
      if (status !== 201) await Bun.sleep(20);
    }
    expect(status).toBe(201);
  });

  test("an upload kept while another streams counts against the one still streaming", async () => {
    let peak = 0;
    const sampled: Write = async (path, source) => {
      const file = await open(path, "w");
      try {
        for await (const chunk of source) {
          await file.write(chunk);
          peak = Math.max(peak, onDisk());
        }
      } finally {
        await file.close();
      }
    };
    const base = await serve(sampled);
    const slow = await rawUpload(base, stl(40), 500);
    await until("the slow upload's first bytes on disk", () => partBytes() >= 400);
    expect((await upload(base, stl(40))).status).toBe(201);
    expect(await slow.finish()).toBe("HTTP/1.1 507 Insufficient Storage");
    expect(peak).toBeLessThanOrEqual(CAP);
  });

  test("the last re-count catches a file that appeared while the upload streamed", async () => {
    const base = await serve(streamTo);
    const late = await rawUpload(base, stl(20), 500);
    await until("the upload's first bytes on disk", () => partBytes() >= 400);
    writeFileSync(join(dir, `${UUID}.stl`), Buffer.alloc(CAP - 1000));
    expect(await late.finish()).toBe("HTTP/1.1 507 Insufficient Storage");
    expect(partBytes()).toBe(0);
  });

  test("a part left behind by a crash counts as stored", async () => {
    const base = await serve(streamTo);
    writeFileSync(join(dir, `${UUID}.stl.part`), Buffer.alloc(CAP - 100));
    expect((await upload(base, stl(20))).status).toBe(507);
  });
});
