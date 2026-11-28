import { randomUUID } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { type UploadSettings, uploadSettings } from "@conveyor/shared/uploads";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { closeAfterReply } from "./close-after.js";
import { HEAD_BYTES, looksLikeStl, readFailure } from "./stl-check.js";
import {
  realTimers,
  type Timers,
  UploadTimeout,
  type UploadTimer,
  uploadTimer,
} from "./upload-timer.js";
import {
  DEFAULT_RESCAN_MS,
  FOLDER_FULL,
  FolderFull,
  folderBudget,
  folderBytes,
  type Reservation,
} from "./uploads-folder.js";

export type Write = (path: string, source: AsyncIterable<Buffer>) => Promise<void>;

export const streamTo: Write = async (path, source) => {
  const file = await open(path, "w");
  await pipeline(source, file.createWriteStream());
};

const INCOMPLETE = "the upload didn't finish. Try again.";
const TOO_SLOW = "the upload took too long. Try again on a faster connection.";

class ClientRead extends Error {}

export interface Received {
  size: number;
  head: Buffer;
}

async function* tap(
  source: AsyncIterable<Buffer>,
  seen: Received,
  touch: () => void,
  take: (bytes: number) => void,
): AsyncIterable<Buffer> {
  try {
    for await (const chunk of source) {
      touch();
      take(chunk.byteLength);
      seen.size += chunk.byteLength;
      if (seen.head.byteLength < HEAD_BYTES)
        seen.head = Buffer.concat([
          seen.head,
          chunk.subarray(0, HEAD_BYTES - seen.head.byteLength),
        ]);
      yield chunk;
    }
  } catch (error) {
    if (error instanceof FolderFull) throw error;
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
  touch: () => void = () => undefined,
  take: (bytes: number) => void = () => undefined,
): Promise<Received> {
  const seen: Received = { size: 0, head: Buffer.alloc(0) };
  try {
    await write(part, tap(source, seen, touch, take));
  } catch (error) {
    await removePart(part, error);
    throw error;
  }
  return seen;
}

const timedOut = (error: unknown) =>
  error instanceof UploadTimeout ||
  (error instanceof ClientRead && error.cause instanceof UploadTimeout);

function cutOff(req: FastifyRequest, reply: FastifyReply) {
  if (reply.raw.headersSent) {
    req.socket.destroy();
    return reply;
  }
  return closeAfterReply(req, reply).code(408).send({ error: TOO_SLOW });
}

interface Target {
  uploadId: string;
  path: string;
  part: string;
  hold?: Reservation;
}

export async function registerUploadRoutes(
  app: FastifyInstance,
  settings: UploadSettings = uploadSettings(process.env),
  write: Write = streamTo,
  timers: Timers = realTimers,
  rescanMs = DEFAULT_RESCAN_MS,
): Promise<void> {
  const cap = settings.folderMaxBytes;
  const budget = cap === undefined ? undefined : await folderBudget(settings.dir, cap, rescanMs);
  app.post("/uploads", async (req, reply) => {
    const timer = uploadTimer(settings, timers);
    const uploadId = randomUUID();
    const path = join(settings.dir, `${uploadId}.stl`);
    const target: Target = { uploadId, path, part: `${path}.part` };
    try {
      return await receive(req, reply, target, timer);
    } catch (error) {
      if (!timedOut(error)) throw error;
      return cutOff(req, reply);
    } finally {
      timer.clear();
      target.hold?.release();
    }
  });

  async function receive(
    req: FastifyRequest,
    reply: FastifyReply,
    target: Target,
    timer: UploadTimer,
  ) {
    const { uploadId, path, part } = target;
    const refuse = async (status: number, error: string) => {
      await removePart(part, new Error(error));
      target.hold?.release();
      return reply.code(status).send({ error });
    };
    const failed = (status: 400 | 413) =>
      refuse(status, status === 413 ? `file exceeds ${settings.maxBytes} bytes` : INCOMPLETE);
    let file: Awaited<ReturnType<typeof req.file>>;
    try {
      file = await Promise.race([
        req.file({ limits: { fileSize: settings.maxBytes } }),
        timer.expired,
      ]);
    } catch (error) {
      if (timedOut(error)) throw error;
      const status = readFailure(error);
      if (!status) throw error;
      return failed(status);
    }
    if (!file) return reply.code(400).send({ error: "no file in multipart body" });
    const stream = file.file;
    timer.onExpire((error) => stream.destroy(error));
    const name = file.filename ?? "model.stl";
    if (!name.toLowerCase().endsWith(".stl")) {
      return reply.code(415).send({ error: "only .stl uploads are supported in v1" });
    }
    await mkdir(settings.dir, { recursive: true });
    const full = async () => {
      closeAfterReply(req, reply);
      return refuse(507, FOLDER_FULL);
    };
    const hold = await budget?.start(part);
    target.hold = hold;
    if (hold?.full()) return full();
    let seen: Received;
    try {
      seen = await store(part, stream, write, timer.touch, hold?.take);
    } catch (error) {
      if (timedOut(error)) throw error;
      if (error instanceof FolderFull) return full();
      const status = error instanceof ClientRead ? readFailure(error.cause) : null;
      if (!status) throw error;
      return failed(status);
    }
    if (file.file.truncated) return failed(413);
    if (!seen.size) return refuse(400, "the file is empty.");
    if (!looksLikeStl(seen.head, seen.size)) return refuse(400, "the file isn't an STL model.");
    if (cap !== undefined && (await folderBytes(settings.dir)) > cap) {
      return refuse(507, FOLDER_FULL);
    }
    await rename(part, path);
    hold?.commit(seen.size);

    req.log.info(`upload ${uploadId} (${name}, ${seen.size} bytes)`);
    return reply.code(201).send({ uploadId, filename: name, bytes: seen.size });
  }
}
