import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { type AllowedHosts, hostAllowed, UNKNOWN_HOST_REFUSED } from "./allowed-hosts.js";
import { closeAfterReply, sendsUploadBody } from "./routes/close-after.js";

export const CROSS_ORIGIN_REFUSED = "cross-origin request refused";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const OWN_FETCH_SITES = new Set(["same-origin", "none"]);
const WEB_SCHEMES = new Set(["http:", "https:"]);

export interface WriteRequest {
  method: string;
  host: string;
  origin: string | undefined;
  fetchSite: string | undefined;
  websocket: boolean;
}

export function isCrossOriginWrite(req: WriteRequest): boolean {
  const { method, host, origin, fetchSite, websocket } = req;
  if (SAFE_METHODS.has(method) && !websocket) return false;
  if (fetchSite !== undefined && !OWN_FETCH_SITES.has(fetchSite)) return true;
  if (origin === undefined) return false;
  try {
    const from = new URL(origin);
    if (!WEB_SCHEMES.has(from.protocol)) return true;
    return from.host !== new URL(`${from.protocol}//${host}`).host;
  } catch {
    return true;
  }
}

const isWebSocket = (req: FastifyRequest) =>
  String(req.headers.upgrade ?? "").toLowerCase() === "websocket";

export function registerOriginGuard(app: FastifyInstance, allowed: AllowedHosts): void {
  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    const refusal = hostAllowed(allowed, req.host)
      ? isCrossOriginWrite({
          method: req.method,
          host: req.host,
          origin: req.headers.origin,
          fetchSite: req.headers["sec-fetch-site"],
          websocket: isWebSocket(req),
        }) && { code: 403, error: CROSS_ORIGIN_REFUSED }
      : { code: 421, error: UNKNOWN_HOST_REFUSED };
    if (!refusal) return;
    if (sendsUploadBody(req)) closeAfterReply(req, reply);
    return reply.code(refusal.code).send({ error: refusal.error });
  });
}
