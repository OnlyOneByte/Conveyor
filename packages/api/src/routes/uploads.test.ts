import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import multipart from "@fastify/multipart";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { registerErrorReplies } from "../error-replies.js";
import { registerUploadRoutes } from "./uploads.js";

const dir = mkdtempSync(join(tmpdir(), "conveyor-api-uploads-"));
const maxBytes = 84 + 50 * 3;
let app: FastifyInstance;
let base = "";

const uploaded = z.object({ uploadId: z.string(), filename: z.string(), bytes: z.number() });

beforeAll(async () => {
  app = Fastify();
  await app.register(multipart, { limits: { fileSize: maxBytes } });
  await registerUploadRoutes(app, { dir, maxBytes });
  base = await app.listen({ host: "127.0.0.1", port: 0 });
});

afterAll(async () => {
  app.server.closeAllConnections();
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

const ASCII = "solid bin\nfacet normal 0 0 1\nendfacet\nendsolid bin\n";

function binaryStl(facets: number): Uint8Array {
  const bytes = new Uint8Array(84 + 50 * facets);
  new DataView(bytes.buffer).setUint32(80, facets, true);
  return bytes;
}

function upload(filename: string, content: string | Uint8Array): Promise<Response> {
  const form = new FormData();
  form.append("file", new Blob([content]), filename);
  return fetch(`${base}/uploads`, { method: "POST", body: form });
}

async function uploadOk(filename: string, content: string | Uint8Array) {
  const res = await upload(filename, content);
  expect(res.status).toBe(201);
  return uploaded.parse(await res.json());
}

describe("POST /uploads", () => {
  test("stores an .stl under a fresh upload id and returns its size", async () => {
    const stl = ASCII;
    const body = await uploadOk("Bin.STL", stl);
    expect(body).toEqual({ uploadId: expect.any(String), filename: "Bin.STL", bytes: stl.length });
    expect(body.uploadId).toMatch(/^[0-9a-f-]{36}$/);
    expect(readFileSync(join(dir, `${body.uploadId}.stl`), "utf8")).toBe(stl);
  });

  test("gives two uploads of the same file different ids", async () => {
    const first = await uploadOk("a.stl", ASCII);
    const second = await uploadOk("a.stl", ASCII);
    expect(first.uploadId).not.toBe(second.uploadId);
  });

  test("rejects a file that is not .stl with 415 and stores nothing", async () => {
    const before = readdirSync(dir).length;
    const res = await upload("model.obj", "o cube\n");
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: "only .stl uploads are supported in v1" });
    expect(readdirSync(dir).length).toBe(before);
  });

  test("rejects a file over the size limit with 413 and stores nothing", async () => {
    const before = readdirSync(dir).length;
    const res = await upload("big.stl", "x".repeat(maxBytes + 1));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: `file exceeds ${maxBytes} bytes` });
    expect(readdirSync(dir).length).toBe(before);
  });

  test("accepts a file of exactly the size limit", async () => {
    expect((await uploadOk("edge.stl", binaryStl(3))).bytes).toBe(maxBytes);
  });

  test("accepts a binary STL whose size matches its triangle count", async () => {
    expect((await uploadOk("one.stl", binaryStl(1))).bytes).toBe(134);
  });

  test.each([
    ["an empty file", "", "the file is empty."],
    ["random bytes", "not a model at all", "the file isn't an STL model."],
    ["ASCII with no facets", "solid bin\nendsolid bin\n", "the file isn't an STL model."],
    [
      "a binary STL missing a triangle",
      binaryStl(2).subarray(0, 84 + 50),
      "the file isn't an STL model.",
    ],
  ])("rejects %s with 400 and stores nothing", async (_, content, error) => {
    const before = readdirSync(dir).length;
    const res = await upload("model.stl", content);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
    expect(readdirSync(dir).length).toBe(before);
  });

  test("a body cut off mid-file is a 400, not a 413, and stores nothing", async () => {
    const before = readdirSync(dir).length;
    const head = '--B\r\nContent-Disposition: form-data; name="file"; filename="a.stl"\r\n\r\n';
    const res = await fetch(`${base}/uploads`, {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=B" },
      body: `${head}solid bin\nfacet`,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "the upload didn't finish. Try again." });
    expect(readdirSync(dir).length).toBe(before);
  });

  test("a multipart body without a file is a 400", async () => {
    const form = new FormData();
    form.append("note", "no file here");
    const res = await fetch(`${base}/uploads`, { method: "POST", body: form });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "no file in multipart body" });
  });

  test("rejects a body that is not multipart with 406", async () => {
    const res = await fetch(`${base}/uploads`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file: "x" }),
    });
    expect(res.status).toBe(406);
  });
});

describe("POST /uploads when storage fails", () => {
  const blocked = join(dir, "not-a-dir");
  let broken: FastifyInstance;
  let at = "";

  beforeAll(async () => {
    writeFileSync(blocked, "");
    broken = Fastify();
    registerErrorReplies(broken);
    await broken.register(multipart, { limits: { fileSize: maxBytes } });
    await registerUploadRoutes(broken, { dir: join(blocked, "uploads"), maxBytes });
    at = await broken.listen({ host: "127.0.0.1", port: 0 });
  });

  afterAll(async () => {
    broken.server.closeAllConnections();
    await broken.close();
  });

  test("is a 500, because the fault is the server's, not the upload's", async () => {
    const form = new FormData();
    form.append("file", new Blob([ASCII]), "bin.stl");
    const res = await fetch(`${at}/uploads`, { method: "POST", body: form });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal error" });
  });
});

describe("POST /uploads when the write fails partway", () => {
  const full = mkdtempSync(join(tmpdir(), "conveyor-api-uploads-full-"));
  let app: FastifyInstance;
  let at = "";

  beforeAll(async () => {
    app = Fastify();
    registerErrorReplies(app);
    await app.register(multipart, { limits: { fileSize: maxBytes } });
    const diskFull = async (path: string, data: Buffer) => {
      writeFileSync(path, data.subarray(0, 10));
      throw Object.assign(new Error("no space left on device"), { code: "ENOSPC" });
    };
    await registerUploadRoutes(app, { dir: full, maxBytes }, diskFull);
    at = await app.listen({ host: "127.0.0.1", port: 0 });
  });

  afterAll(async () => {
    app.server.closeAllConnections();
    await app.close();
    rmSync(full, { recursive: true, force: true });
  });

  test("is a 500 and leaves no partial file in the uploads folder", async () => {
    const form = new FormData();
    form.append("file", new Blob([ASCII]), "bin.stl");
    const res = await fetch(`${at}/uploads`, { method: "POST", body: form });
    expect(res.status).toBe(500);
    expect(readdirSync(full)).toEqual([]);
  });
});
