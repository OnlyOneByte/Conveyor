import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import multipart from "@fastify/multipart";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { registerUploadRoutes } from "./uploads.js";

const dir = mkdtempSync(join(tmpdir(), "conveyor-api-uploads-"));
const maxBytes = 64;
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

function upload(filename: string, content: string): Promise<Response> {
  const form = new FormData();
  form.append("file", new Blob([content]), filename);
  return fetch(`${base}/uploads`, { method: "POST", body: form });
}

async function uploadOk(filename: string, content: string) {
  const res = await upload(filename, content);
  expect(res.status).toBe(201);
  return uploaded.parse(await res.json());
}

describe("POST /uploads", () => {
  test("stores an .stl under a fresh upload id and returns its size", async () => {
    const stl = "solid bin\nendsolid bin\n";
    const body = await uploadOk("Bin.STL", stl);
    expect(body).toEqual({ uploadId: expect.any(String), filename: "Bin.STL", bytes: stl.length });
    expect(body.uploadId).toMatch(/^[0-9a-f-]{36}$/);
    expect(readFileSync(join(dir, `${body.uploadId}.stl`), "utf8")).toBe(stl);
  });

  test("gives two uploads of the same file different ids", async () => {
    const first = await uploadOk("a.stl", "x");
    const second = await uploadOk("a.stl", "x");
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
    expect((await uploadOk("edge.stl", "x".repeat(maxBytes))).bytes).toBe(maxBytes);
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
