import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";

export async function registerUploadRoutes(app: FastifyInstance): Promise<void> {
  const dataDir = process.env.DATA_DIR ?? "/data";
  const uploadDir = process.env.UPLOAD_DIR ?? join(dataDir, "uploads");
  const maxUploadBytes = Number(process.env.MAX_UPLOAD_BYTES ?? 100 * 1024 * 1024);

  app.post("/uploads", async (req, reply) => {
    const file = await req.file({ limits: { fileSize: maxUploadBytes } });
    if (!file) return reply.code(400).send({ error: "no file in multipart body" });

    const name = file.filename ?? "model.stl";
    if (!name.toLowerCase().endsWith(".stl")) {
      return reply.code(415).send({ error: "only .stl uploads are supported in v1" });
    }

    const uploadId = randomUUID();
    await mkdir(uploadDir, { recursive: true });
    const dest = join(uploadDir, `${uploadId}.stl`);

    let buf: Buffer;
    try {
      buf = await file.toBuffer();
    } catch {
      return reply.code(413).send({ error: `file exceeds ${maxUploadBytes} bytes` });
    }
    await writeFile(dest, buf);

    req.log.info(`upload ${uploadId} (${name}, ${buf.byteLength} bytes)`);
    return reply.code(201).send({ uploadId, filename: name, bytes: buf.byteLength });
  });
}
