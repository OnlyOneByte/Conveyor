import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * STL upload endpoint for the passthrough generator (SPEC §8 → v1). Stores the
 * uploaded bytes under <DATA_DIR>/uploads/<uploadId>.stl on the shared /data
 * volume; the worker's passthrough plugin reads them from the same path.
 *
 * Returns an opaque uploadId the PWA then submits as the passthrough generator's
 * `params.uploadId`. The bytes are NOT trusted as code — they're handed to the
 * slicer as-is; we only enforce a size cap + .stl extension here.
 */
const DATA_DIR = process.env.DATA_DIR ?? "/data";
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? join(DATA_DIR, "uploads");
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 100 * 1024 * 1024); // 100 MB

export async function registerUploadRoutes(app: FastifyInstance): Promise<void> {
  app.post("/uploads", async (req, reply) => {
    const file = await req.file({ limits: { fileSize: MAX_UPLOAD_BYTES } });
    if (!file) return reply.code(400).send({ error: "no file in multipart body" });

    const name = file.filename ?? "model.stl";
    if (!name.toLowerCase().endsWith(".stl")) {
      return reply.code(415).send({ error: "only .stl uploads are supported in v1" });
    }

    const uploadId = randomUUID();
    await mkdir(UPLOAD_DIR, { recursive: true });
    const dest = join(UPLOAD_DIR, `${uploadId}.stl`);

    // toBuffer() rejects with a 413-equivalent if the stream exceeds fileSize.
    let buf: Buffer;
    try {
      buf = await file.toBuffer();
    } catch {
      return reply.code(413).send({ error: `file exceeds ${MAX_UPLOAD_BYTES} bytes` });
    }
    await writeFile(dest, buf);

    req.log.info(`upload ${uploadId} (${name}, ${buf.byteLength} bytes)`);
    return reply.code(201).send({ uploadId, filename: name, bytes: buf.byteLength });
  });
}
