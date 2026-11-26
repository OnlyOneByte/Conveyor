import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { type UploadSettings, uploadSettings } from "@conveyor/shared/uploads";
import type { FastifyInstance } from "fastify";
import { HEAD_BYTES, looksLikeStl, readFailure } from "./stl-check.js";

export type Write = (path: string, source: AsyncIterable<Buffer>) => Promise<void>;

const streamTo: Write = (path, source) => pipeline(source, createWriteStream(path));

const INCOMPLETE = "the upload didn't finish. Try again.";

class ClientRead extends Error {}

export interface Received {
  size: number;
  head: Buffer;
}

async function* tap(source: AsyncIterable<Buffer>, seen: Received): AsyncIterable<Buffer> {
  try {
    for await (const chunk of source) {
      seen.size += chunk.byteLength;
      if (seen.head.byteLength < HEAD_BYTES)
        seen.head = Buffer.concat([
          seen.head,
          chunk.subarray(0, HEAD_BYTES - seen.head.byteLength),
        ]);
      yield chunk;
    }
  } catch (error) {
    throw new ClientRead("the upload stream failed", { cause: error });
  }
}

async function removePart(part: string, error: unknown): Promise<void> {
  await rm(part, { force: true }).catch((cleanup: unknown) => {
    throw new Error(`couldn't remove ${part}: ${String(cleanup)}`, { cause: error });
  });
}

export async function store(
  part: string,
  source: AsyncIterable<Buffer>,
  write: Write,
): Promise<Received> {
  const seen: Received = { size: 0, head: Buffer.alloc(0) };
  try {
    await write(part, tap(source, seen));
  } catch (error) {
    await removePart(part, error);
    throw error;
  }
  return seen;
}

export async function registerUploadRoutes(
  app: FastifyInstance,
  settings: UploadSettings = uploadSettings(process.env),
  write: Write = streamTo,
): Promise<void> {
  app.post("/uploads", async (req, reply) => {
    const uploadId = randomUUID();
    const path = join(settings.dir, `${uploadId}.stl`);
    const part = `${path}.part`;
    const refuse = async (status: number, error: string) => {
      await removePart(part, new Error(error));
      return reply.code(status).send({ error });
    };
    const failed = (status: 400 | 413) =>
      refuse(status, status === 413 ? `file exceeds ${settings.maxBytes} bytes` : INCOMPLETE);
    let file: Awaited<ReturnType<typeof req.file>>;
    try {
      file = await req.file({ limits: { fileSize: settings.maxBytes } });
    } catch (error) {
      const status = readFailure(error);
      if (!status) throw error;
      return failed(status);
    }
    if (!file) return reply.code(400).send({ error: "no file in multipart body" });
    const name = file.filename ?? "model.stl";
    if (!name.toLowerCase().endsWith(".stl")) {
      return reply.code(415).send({ error: "only .stl uploads are supported in v1" });
    }
    await mkdir(settings.dir, { recursive: true });
    let seen: Received;
    try {
      seen = await store(part, file.file, write);
    } catch (error) {
      const status = error instanceof ClientRead ? readFailure(error.cause) : null;
      if (!status) throw error;
      return failed(status);
    }
    if (file.file.truncated) return failed(413);
    if (!seen.size) return refuse(400, "the file is empty.");
    if (!looksLikeStl(seen.head, seen.size)) return refuse(400, "the file isn't an STL model.");
    await rename(part, path);

    req.log.info(`upload ${uploadId} (${name}, ${seen.size} bytes)`);
    return reply.code(201).send({ uploadId, filename: name, bytes: seen.size });
  });
}
