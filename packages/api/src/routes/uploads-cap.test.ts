import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import multipart from "@fastify/multipart";
import Fastify, { type FastifyInstance } from "fastify";
import { registerUploadRoutes, streamTo, type Write } from "./uploads.js";
import { FOLDER_FULL } from "./uploads-folder.js";

const SLACK = { idleMs: 30_000, deadlineMs: 600_000 };
const FILE = 84 + 50 * 1;
const UUID = "0b3f6c1e-6a4d-4c3e-9f1a-2d5e7b8c9a01";
let app: FastifyInstance | undefined;
let dir = "";

afterEach(async () => {
  app?.server.closeAllConnections();
  await app?.close();
  app = undefined;
  rmSync(dir, { recursive: true, force: true });
});

async function serve(folderMaxBytes: number | undefined, write: Write = streamTo) {
  dir = mkdtempSync(join(tmpdir(), "conveyor-api-uploads-cap-"));
  app = Fastify();
  await app.register(multipart, { limits: { fileSize: 4096 } });
  await registerUploadRoutes(app, { dir, maxBytes: 4096, folderMaxBytes, ...SLACK }, write);
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

const stored = () => readdirSync(dir).filter((name) => name.endsWith(".stl"));
const parts = () => readdirSync(dir).filter((name) => name.endsWith(".part"));
const bytesIn = (names: string[]) =>
  names.reduce((total, name) => total + statSync(join(dir, name)).size, 0);

describe("CONVEYOR_UPLOADS_MAX_BYTES", () => {
  test("fills the folder exactly to the cap, then answers 507 and keeps nothing", async () => {
    const base = await serve(3 * FILE);
    for (let i = 0; i < 3; i++) expect((await upload(base, stl(1))).status).toBe(201);
    const over = await upload(base, stl(1));
    expect(over.status).toBe(507);
    expect(await over.json()).toEqual({ error: FOLDER_FULL });
    expect(bytesIn(stored())).toBe(3 * FILE);
    expect(parts()).toEqual([]);
  });

  test("refuses the file that would pass the cap by one byte", async () => {
    const base = await serve(3 * FILE - 1);
    expect((await upload(base, stl(1))).status).toBe(201);
    expect((await upload(base, stl(1))).status).toBe(201);
    expect((await upload(base, stl(1))).status).toBe(507);
    expect(stored()).toHaveLength(2);
  });

  test("stops a file bigger than the room left while it streams, and closes the connection", async () => {
    const base = await serve(FILE + 100);
    const res = await upload(base, stl(10));
    expect(res.status).toBe(507);
    expect(res.headers.get("connection")).toBe("close");
    expect([stored(), parts()]).toEqual([[], []]);
  });

  test("refuses at once, writing nothing, when the folder is already full", async () => {
    let writes = 0;
    const counted: Write = async (path, source) => {
      writes++;
      await streamTo(path, source);
    };
    const base = await serve(FILE, counted);
    expect((await upload(base, stl(1))).status).toBe(201);
    const res = await upload(base, stl(1));
    expect([res.status, writes]).toEqual([507, 1]);
    expect(res.headers.get("connection")).toBe("close");
  });

  test("counts only files the API created", async () => {
    const base = await serve(2 * FILE);
    writeFileSync(join(dir, "notes.txt"), Buffer.alloc(10_000));
    writeFileSync(join(dir, "other.stl"), Buffer.alloc(10_000));
    expect((await upload(base, stl(1))).status).toBe(201);
    writeFileSync(join(dir, `${UUID}.stl`), Buffer.alloc(FILE));
    expect((await upload(base, stl(1))).status).toBe(507);
  });

  test("never stores more than the cap from concurrent uploads, and leaves no parts", async () => {
    const slow: Write = async (path, source) => {
      await streamTo(path, source);
      await Bun.sleep(20);
    };
    const base = await serve(2 * FILE, slow);
    const results = await Promise.all(Array.from({ length: 6 }, () => upload(base, stl(1))));
    const created = results.filter((res) => res.status === 201).length;
    expect(results.every((res) => res.status === 201 || res.status === 507)).toBe(true);
    expect(created).toBeLessThanOrEqual(2);
    expect(bytesIn(stored())).toBeLessThanOrEqual(2 * FILE);
    expect(parts()).toEqual([]);
    for (let i = created; i < 2; i++) expect((await upload(base, stl(1))).status).toBe(201);
    expect(stored()).toHaveLength(2);
    expect((await upload(base, stl(1))).status).toBe(507);
  });

  test("unset, the folder has no cap", async () => {
    const base = await serve(undefined);
    for (let i = 0; i < 5; i++) expect((await upload(base, stl(10))).status).toBe(201);
  });
});
