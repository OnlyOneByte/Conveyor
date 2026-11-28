import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { closeAfterReply, sendsUploadBody } from "./routes/close-after.js";

export const CROSS_ORIGIN_REFUSED = "cross-origin request refused";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const OWN_FETCH_SITES = new Set(["same-origin", "none"]);

export interface WriteRequest {
  method: string;
  host: string;
  origin: string | undefined;
  fetchSite: string | undefined;
}

export function isCrossOriginWrite({ method, host, origin, fetchSite }: WriteRequest): boolean {
  if (SAFE_METHODS.has(method)) return false;
  if (fetchSite !== undefined && !OWN_FETCH_SITES.has(fetchSite)) return true;
  if (origin === undefined) return false;
  try {
    const from = new URL(origin);
    return from.host === "" || from.host !== new URL(`${from.protocol}//${host}`).host;
  } catch {
    return true;
  }
}

export function registerOriginGuard(app: FastifyInstance): void {
  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    const write = {
      method: req.method,
      host: req.host,
      origin: req.headers.origin,
      fetchSite: req.headers["sec-fetch-site"],
    };
    if (!isCrossOriginWrite(write)) return;
    if (sendsUploadBody(req)) closeAfterReply(req, reply);
    return reply.code(403).send({ error: CROSS_ORIGIN_REFUSED });
  });
}
