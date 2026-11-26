import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import multipart from "@fastify/multipart";
import Fastify from "fastify";
import { z } from "zod";
import { HEAD_BYTES } from "./stl-check.js";
import { registerUploadRoutes, store, type Write } from "./uploads.js";

const maxBytes = 84 + 50 * 3;
const SLACK = { idleMs: 30_000, deadlineMs: 600_000 };
const ASCII = "solid bin\nfacet normal 0 0 1\nendfacet\nendsolid bin\n";
const uploaded = z.object({ uploadId: z.string(), filename: z.string(), bytes: z.number() });

describe("storing an upload", () => {
  const into = mkdtempSync(join(tmpdir(), "conveyor-api-uploads-stream-"));
  afterAll(() => rmSync(into, { recursive: true, force: true }));

  test("each chunk reaches the disk before the next one arrives, so nothing is held whole", async () => {
    const part = join(into, "streamed.stl.part");
    let release = () => {};
    const reached = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sizes: number[] = [];
    async function* slow() {
      yield Buffer.from("solid bin\n");
      await Promise.race([
        reached,
        Bun.sleep(2000).then(() => {
          throw new Error("the first chunk never reached the writer");
        }),
      ]);
      yield Buffer.from("facet normal 0 0 1\nendsolid bin\n");
    }
    const watching: Write = async (path, source) => {
      for await (const chunk of source) {
        sizes.push(chunk.byteLength);
        release();
      }
      writeFileSync(path, "");
    };
    const seen = await store(part, slow(), watching);
    expect(sizes).toEqual([10, 32]);
    expect(seen.size).toBe(42);
    expect(seen.head.toString()).toBe("solid bin\nfacet normal 0 0 1\nendsolid bin\n");
  });

  test("only the first bytes are kept for the STL check, however big the upload", async () => {
    const part = join(into, "big.stl.part");
    async function* big() {
      for (let i = 0; i < 64; i++) yield Buffer.alloc(1024, 0x61);
    }
    const seen = await store(part, big(), async (path, source) => {
      for await (const _ of source);
      writeFileSync(path, "");
    });
    expect(seen.size).toBe(64 * 1024);
    expect(seen.head.byteLength).toBe(HEAD_BYTES);
  });

  test("the default writer streams the bytes to the .part file", async () => {
    const app = Fastify();
    await app.register(multipart, { limits: { fileSize: maxBytes } });
    const folder = join(into, "default");
    await registerUploadRoutes(app, { dir: folder, maxBytes, ...SLACK });
    const at = await app.listen({ host: "127.0.0.1", port: 0 });
    try {
      const form = new FormData();
      form.append("file", new Blob([ASCII]), "bin.stl");
      const res = await fetch(`${at}/uploads`, { method: "POST", body: form });
      const { uploadId } = uploaded.parse(await res.json());
      expect(readdirSync(folder)).toEqual([`${uploadId}.stl`]);
      expect(readFileSync(join(folder, `${uploadId}.stl`), "utf8")).toBe(ASCII);
    } finally {
      app.server.closeAllConnections();
      await app.close();
    }
  });
});
