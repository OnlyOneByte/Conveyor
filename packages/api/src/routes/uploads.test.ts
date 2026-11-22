import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import multipart from "@fastify/multipart";
import Fastify from "fastify";
import { z } from "zod";
import { registerUploadRoutes } from "./uploads.js";

const dir = mkdtempSync(join(tmpdir(), "conveyor-uploads-"));
const uploadDir = join(dir, "uploads");
const previous = { dir: process.env.UPLOAD_DIR, max: process.env.MAX_UPLOAD_BYTES };

const app = Fastify();
let base = "";

const uploaded = z.object({ uploadId: z.string(), filename: z.string(), bytes: z.number() });

async function uploadOk(name: string, bytes: string) {
  const res = await upload(name, bytes);
  expect(res.status).toBe(201);
  return uploaded.parse(await res.json());
}

function upload(name: string, bytes: string): Promise<Response> {
  const form = new FormData();
  form.append("file", new File([bytes], name));
  return fetch(`${base}/uploads`, { method: "POST", body: form });
}

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeAll(async () => {
  process.env.UPLOAD_DIR = uploadDir;
  process.env.MAX_UPLOAD_BYTES = "64";
  mkdirSync(uploadDir, { recursive: true });
  await app.register(multipart);
  await registerUploadRoutes(app);
  base = await app.listen({ host: "127.0.0.1", port: 0 });
});

afterAll(async () => {
  await app.close();
  restore("UPLOAD_DIR", previous.dir);
  restore("MAX_UPLOAD_BYTES", previous.max);
  rmSync(dir, { recursive: true, force: true });
});

describe("POST /uploads", () => {
  test("stores an STL under a fresh upload id and reports its size", async () => {
    const body = await uploadOk("Bracket.STL", "solid bracket\n");
    expect(body).toEqual({ uploadId: expect.any(String), filename: "Bracket.STL", bytes: 14 });
    expect(body.uploadId).toMatch(/^[0-9a-f-]{36}$/);
    expect(readFileSync(join(uploadDir, `${body.uploadId}.stl`), "utf8")).toBe("solid bracket\n");
  });

  test("gives two uploads of the same file different ids", async () => {
    const first = await uploadOk("a.stl", "x");
    const second = await uploadOk("a.stl", "x");
    expect(first.uploadId).not.toBe(second.uploadId);
  });

  test("refuses a file that is not an STL with a 415 and stores nothing", async () => {
    const before = readdirSync(uploadDir).length;
    const res = await upload("model.3mf", "PK");
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: "only .stl uploads are supported in v1" });
    expect(readdirSync(uploadDir).length).toBe(before);
  });

  test("refuses a file over MAX_UPLOAD_BYTES with a 413 and stores nothing", async () => {
    const before = readdirSync(uploadDir).length;
    const res = await upload("big.stl", "x".repeat(65));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "file exceeds 64 bytes" });
    expect(readdirSync(uploadDir).length).toBe(before);
  });

  test("accepts a file of exactly MAX_UPLOAD_BYTES", async () => {
    expect((await uploadOk("edge.stl", "x".repeat(64))).bytes).toBe(64);
  });

  test("a multipart body without a file is a 400", async () => {
    const form = new FormData();
    form.append("note", "no file here");
    const res = await fetch(`${base}/uploads`, { method: "POST", body: form });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "no file in multipart body" });
  });
});
