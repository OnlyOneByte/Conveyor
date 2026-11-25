import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type UploadSettings, uploadSettings } from "@conveyor/shared/uploads";
import type { FastifyInstance } from "fastify";
import { looksLikeStl, readFailure } from "./stl-check.js";

const INCOMPLETE = "the upload didn't finish. Try again.";

export async function registerUploadRoutes(
  app: FastifyInstance,
  settings: UploadSettings = uploadSettings(process.env),
): Promise<void> {
  app.post("/uploads", async (req, reply) => {
    let name: string;
    let buf: Buffer;
    try {
      const file = await req.file({ limits: { fileSize: settings.maxBytes } });
      if (!file) return reply.code(400).send({ error: "no file in multipart body" });
      name = file.filename ?? "model.stl";
      if (!name.toLowerCase().endsWith(".stl")) {
        return reply.code(415).send({ error: "only .stl uploads are supported in v1" });
      }
      buf = await file.toBuffer();
    } catch (error) {
      const status = readFailure(error);
      if (!status) throw error;
      const said = status === 413 ? `file exceeds ${settings.maxBytes} bytes` : INCOMPLETE;
      return reply.code(status).send({ error: said });
    }
    if (!buf.byteLength) return reply.code(400).send({ error: "the file is empty." });
    if (!looksLikeStl(buf)) return reply.code(400).send({ error: "the file isn't an STL model." });

    const uploadId = randomUUID();
    await mkdir(settings.dir, { recursive: true });
    await writeFile(join(settings.dir, `${uploadId}.stl`), buf);

    req.log.info(`upload ${uploadId} (${name}, ${buf.byteLength} bytes)`);
    return reply.code(201).send({ uploadId, filename: name, bytes: buf.byteLength });
  });
}
