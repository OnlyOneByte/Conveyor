import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type UploadSettings, uploadSettings } from "@conveyor/shared/uploads";
import type { FastifyInstance } from "fastify";

export async function registerUploadRoutes(
  app: FastifyInstance,
  settings: UploadSettings = uploadSettings(process.env),
): Promise<void> {
  app.post("/uploads", async (req, reply) => {
    const file = await req.file({ limits: { fileSize: settings.maxBytes } });
    if (!file) return reply.code(400).send({ error: "no file in multipart body" });

    const name = file.filename ?? "model.stl";
    if (!name.toLowerCase().endsWith(".stl")) {
      return reply.code(415).send({ error: "only .stl uploads are supported in v1" });
    }

    const uploadId = randomUUID();
    await mkdir(settings.dir, { recursive: true });
    const dest = join(settings.dir, `${uploadId}.stl`);

    let buf: Buffer;
    try {
      buf = await file.toBuffer();
    } catch {
      return reply.code(413).send({ error: `file exceeds ${settings.maxBytes} bytes` });
    }
    await writeFile(dest, buf);

    req.log.info(`upload ${uploadId} (${name}, ${buf.byteLength} bytes)`);
    return reply.code(201).send({ uploadId, filename: name, bytes: buf.byteLength });
  });
}
