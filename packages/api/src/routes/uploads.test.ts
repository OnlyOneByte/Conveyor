import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import multipart from "@fastify/multipart";
import Fastify, { type FastifyInstance } from "fastify";
import { registerUploadRoutes } from "./uploads.js";

const dir = mkdtempSync(join(tmpdir(), "conveyor-api-uploads-"));
const maxBytes = 64;
let app: FastifyInstance;
let base = "";

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

describe("POST /uploads", () => {
  test("stores an .stl and returns its id and size", async () => {
    const stl = "solid bin\nendsolid bin\n";
    const res = await upload("Bin.STL", stl);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { uploadId: string; filename: string; bytes: number };
    expect(body).toMatchObject({ filename: "Bin.STL", bytes: stl.length });
    expect(readFileSync(join(dir, `${body.uploadId}.stl`), "utf8")).toBe(stl);
  });

  test("rejects a file that is not .stl with 415", async () => {
    const res = await upload("model.obj", "o cube\n");
    expect(res.status).toBe(415);
  });

  test("rejects a file over the size limit with 413", async () => {
    const res = await upload("big.stl", "x".repeat(maxBytes + 1));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: `file exceeds ${maxBytes} bytes` });
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
