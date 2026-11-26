import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import multipart from "@fastify/multipart";
import Fastify, { type FastifyInstance } from "fastify";
import type { Timers } from "./upload-timer.js";
import { registerUploadRoutes } from "./uploads.js";

const TOO_SLOW = { error: "the upload took too long. Try again on a faster connection." };
const maxBytes = 84 + 50 * 200;
const servers: FastifyInstance[] = [];
const dirs: string[] = [];

afterAll(async () => {
  for (const server of servers) {
    server.server.closeAllConnections();
    await server.close();
  }
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

async function serve(idleMs: number, deadlineMs: number, timers?: Timers) {
  const dir = mkdtempSync(join(tmpdir(), "conveyor-api-upload-timeouts-"));
  dirs.push(dir);
  const app = Fastify();
  servers.push(app);
  await app.register(multipart, { limits: { fileSize: maxBytes } });
  await registerUploadRoutes(app, { dir, maxBytes, idleMs, deadlineMs }, undefined, timers);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  return { dir, port: address.port };
}

function binaryStl(facets: number): Buffer {
  const bytes = Buffer.alloc(84 + 50 * facets);
  bytes.writeUInt32LE(facets, 80);
  return bytes;
}

const HEAD = Buffer.from(
  '--B\r\nContent-Disposition: form-data; name="file"; filename="slow.stl"\r\nContent-Type: application/octet-stream\r\n\r\n',
);
const TAIL = Buffer.from("\r\n--B--\r\n");

interface Answer {
  status: number;
  headers: string;
  body: string;
  closed: boolean;
  ms: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function send(port: number, pieces: Buffer[], gapMs: number, declared: number) {
  const started = Date.now();
  const socket = connect(port, "127.0.0.1");
  const seen = { raw: "", closed: false };
  let answered: () => void = () => undefined;
  const complete = () => {
    const [head, body] = seen.raw.split("\r\n\r\n");
    const length = Number(/content-length: (\d+)/i.exec(head ?? "")?.[1] ?? Number.NaN);
    return body !== undefined && body.length >= length;
  };
  const replied = new Promise<void>((resolve) => {
    answered = resolve;
  });
  const ended = new Promise<void>((resolve) => {
    socket.on("data", (data) => {
      seen.raw += data.toString("latin1");
      if (complete()) answered();
    });
    socket.on("close", () => {
      seen.closed = true;
      answered();
      resolve();
    });
    socket.on("error", () => undefined);
  });
  await new Promise<void>((resolve) => socket.once("connect", () => resolve()));
  socket.write(
    `POST /uploads HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: multipart/form-data; boundary=B\r\nContent-Length: ${declared}\r\n\r\n`,
  );
  for (const piece of pieces) {
    if (seen.closed || complete()) break;
    socket.write(piece);
    await sleep(gapMs);
  }
  await Promise.race([replied, sleep(3_000)]);
  const ms = Date.now() - started;
  await Promise.race([ended, sleep(1_000)]);
  socket.destroy();
  const [head = "", body = ""] = seen.raw.split("\r\n\r\n");
  return {
    status: Number(/^HTTP\/1\.1 (\d{3})/.exec(head)?.[1] ?? 0),
    headers: head.toLowerCase(),
    body,
    closed: seen.closed,
    ms,
  } satisfies Answer;
}

const bytes = (count: number) => Array.from({ length: count }, () => Buffer.from("x"));

describe("POST /uploads against a slow client", () => {
  test("a trickle slower than the idle timeout is cut off with 408 and leaves no .part", async () => {
    const { dir, port } = await serve(300, 10_000);
    const pieces = [Buffer.concat([HEAD, Buffer.from("solid bin\nfacet ")]), ...bytes(20)];
    const answer = await send(port, pieces, 800, 4096);
    expect(answer.status).toBe(408);
    expect(JSON.parse(answer.body)).toEqual(TOO_SLOW);
    expect(answer.headers).toContain("connection: close");
    expect(answer.closed).toBe(true);
    expect(answer.ms).toBeLessThan(3_000);
    expect(readdirSync(dir)).toEqual([]);
  });

  test("a client that stalls before the file part starts is cut off with 408", async () => {
    const { dir, port } = await serve(150, 10_000);
    const answer = await send(port, [Buffer.from("--B\r\n")], 0, 4096);
    expect(answer.status).toBe(408);
    expect(JSON.parse(answer.body)).toEqual(TOO_SLOW);
    expect(answer.closed).toBe(true);
    expect(readdirSync(dir)).toEqual([]);
  });

  test("a trickle fast enough for the idle timeout still hits the overall cap", async () => {
    const { dir, port } = await serve(400, 800);
    const pieces = [HEAD, Buffer.from("solid bin\n"), ...bytes(200)];
    const answer = await send(port, pieces, 40, 4096);
    expect(answer.status).toBe(408);
    expect(JSON.parse(answer.body)).toEqual(TOO_SLOW);
    expect(answer.ms).toBeGreaterThanOrEqual(800);
    expect(readdirSync(dir)).toEqual([]);
  });

  test("a large upload over a slow but steady link completes", async () => {
    const { dir, port } = await serve(400, 10_000);
    const stl = binaryStl(200);
    const body = Buffer.concat([HEAD, stl, TAIL]);
    const pieces = Array.from({ length: Math.ceil(body.byteLength / 512) }, (_, i) =>
      body.subarray(i * 512, (i + 1) * 512),
    );
    const answer = await send(port, pieces, 60, body.byteLength);
    expect(answer.status).toBe(201);
    const stored = JSON.parse(answer.body);
    expect(stored.bytes).toBe(stl.byteLength);
    expect(readdirSync(dir)).toEqual([`${stored.uploadId}.stl`]);
    expect(readFileSync(join(dir, `${stored.uploadId}.stl`)).equals(stl)).toBe(true);
  });
});

describe("POST /uploads timers", () => {
  test("every timer an upload sets is cancelled once it succeeds", async () => {
    const live = new Set<number>();
    let made = 0;
    const timers: Timers = () => {
      const id = made++;
      live.add(id);
      return () => live.delete(id);
    };
    const { port } = await serve(400, 10_000, timers);
    const form = new FormData();
    form.append("file", new Blob([binaryStl(1)]), "one.stl");
    const res = await fetch(`http://127.0.0.1:${port}/uploads`, { method: "POST", body: form });
    expect(res.status).toBe(201);
    expect(made).toBeGreaterThan(2);
    expect([...live]).toEqual([]);
  });
});
