import { afterAll, describe, expect, test } from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { multipartFileUpload } from "./upload.ts";

const dir = mkdtempSync(join(tmpdir(), "conveyor-upload-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function receiver() {
  const seen: { length: number | null; field: string; name: string; sha: string; bytes: number }[] =
    [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    maxRequestBodySize: 2 ** 31,
    async fetch(req) {
      const length = Number(req.headers.get("content-length"));
      const form = await req.formData();
      for (const [field, value] of form) {
        if (typeof value === "string") continue;
        const bytes = new Uint8Array(await value.arrayBuffer());
        seen.push({ length, field, name: value.name, sha: sha(bytes), bytes: bytes.length });
      }
      return new Response("ok");
    },
  });
  return { url: `http://127.0.0.1:${server.port}/upload`, seen, stop: () => server.stop(true) };
}

async function post(url: string, path: string, field: string, filename: string) {
  const upload = multipartFileUpload(field, path, filename);
  return fetch(url, { method: "POST", body: upload.body, headers: upload.headers });
}

describe("multipartFileUpload", () => {
  test("delivers the file's bytes unchanged as a multipart part with its field and name", async () => {
    const path = join(dir, "model.gcode");
    const content = randomBytes(3 * 1024 * 1024 + 17);
    writeFileSync(path, content);
    const server = receiver();
    try {
      const res = await post(server.url, path, "file", "model.gcode");
      expect(res.status).toBe(200);
      expect(server.seen).toEqual([
        {
          length: expect.any(Number),
          field: "file",
          name: "model.gcode",
          sha: sha(content),
          bytes: content.length,
        },
      ]);
    } finally {
      server.stop();
    }
  });

  test("declares the exact body length, so a printer that refuses chunked uploads accepts it", async () => {
    const path = join(dir, "small.gcode");
    writeFileSync(path, "G28\nG1 X10\n");
    const upload = multipartFileUpload("File", path, "small.gcode");
    const sent = new Uint8Array(await new Response(upload.body).arrayBuffer());
    expect(Number(upload.headers["content-length"])).toBe(sent.length);
    expect(upload.headers["content-type"]).toMatch(/^multipart\/form-data; boundary=----conveyor-/);
  });

  test("keeps quotes and line breaks in a filename out of the part header", async () => {
    const path = join(dir, "odd.gcode");
    writeFileSync(path, "G28\n");
    const upload = multipartFileUpload("file", path, 'a"b\r\nX-Evil: 1.gcode');
    const text = await new Response(upload.body).text();
    expect(text).toContain('filename="a_b__X-Evil: 1.gcode"');
    expect(text).not.toContain("\r\nX-Evil");
  });

  test("reads the file in chunks as the body is pulled, not all at once", async () => {
    const path = join(dir, "chunks.gcode");
    const size = 8 * 1024 * 1024;
    writeFileSync(path, randomBytes(size));
    const reader = multipartFileUpload("file", path, "chunks.gcode").body.getReader();
    const head = await reader.read();
    const first = await reader.read();
    await reader.cancel();
    expect(new TextDecoder().decode(head.value)).toContain('name="file"');
    expect(first.value?.length ?? 0).toBeGreaterThan(0);
    expect(first.value?.length ?? size).toBeLessThan(size);
  });

  test("uploads a 160 MB file without holding it in memory", async () => {
    const path = join(dir, "big.gcode");
    const size = 160 * 1024 * 1024;
    writeFileSync(path, Buffer.alloc(size, 0x47));
    const script = join(dir, "probe.ts");
    writeFileSync(
      script,
      `import { multipartFileUpload } from ${JSON.stringify(join(import.meta.dir, "upload.ts"))};
const [path, url] = process.argv.slice(2);
const before = process.memoryUsage().rss;
let peak = before;
const timer = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 2);
const upload = multipartFileUpload("file", path, "big.gcode");
const res = await fetch(url, { method: "POST", body: upload.body, headers: upload.headers });
clearInterval(timer);
peak = Math.max(peak, process.memoryUsage().rss);
console.log(JSON.stringify({ status: res.status, grew: peak - before }));`,
    );
    const server = receiver();
    try {
      const child = Bun.spawn([process.execPath, script, path, server.url], {
        cwd: dir,
        stdout: "pipe",
      });
      const out = await new Response(child.stdout).text();
      expect(await child.exited).toBe(0);
      const { status, grew } = JSON.parse(out) as { status: number; grew: number };
      expect(status).toBe(200);
      expect(server.seen.at(-1)?.bytes).toBe(size);
      expect(grew).toBeLessThan(size / 2);
    } finally {
      server.stop();
    }
  }, 60_000);
});
