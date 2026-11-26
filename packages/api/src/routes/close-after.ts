import type { FastifyReply, FastifyRequest } from "fastify";

export const SMALL_BODY_BYTES = 1024 * 1024;

export function closeAfterReply(req: FastifyRequest, reply: FastifyReply): FastifyReply {
  reply.raw.once("finish", () => req.socket.destroy());
  return reply.header("connection", "close");
}

export const sendsUploadBody = (req: Pick<FastifyRequest, "headers">): boolean =>
  String(req.headers["content-type"] ?? "")
    .toLowerCase()
    .startsWith("multipart/") ||
  req.headers["transfer-encoding"] !== undefined ||
  Number(req.headers["content-length"] ?? 0) > SMALL_BODY_BYTES;
