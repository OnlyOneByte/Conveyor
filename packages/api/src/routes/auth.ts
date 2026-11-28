import type { AuthStatus } from "@conveyor/shared/auth-status";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  authEnabled,
  checkPassword,
  clearCookie,
  issueToken,
  readSessionCookie,
  revokeToken,
  sessionCookie,
  verifyToken,
} from "../auth.js";
import { type LoginLimiter, loginLimiter } from "../login-limit.js";
import { CROSS_ORIGIN_REFUSED, isCrossOriginWrite } from "../origin.js";
import { clientKey } from "../trusted-proxies.js";
import { closeAfterReply, sendsUploadBody } from "./close-after.js";

const loginSchema = z.object({ password: z.string().min(1).max(512) });

function hasSession(req: FastifyRequest): boolean {
  return verifyToken(readSessionCookie(req.headers.cookie));
}

export const PUBLIC_ROUTE = { config: { public: true } } as const;

const isPublic = (req: FastifyRequest) =>
  (req.routeOptions.config as { public?: unknown } | undefined)?.public === true;

export function registerAuthGuard(app: FastifyInstance): void {
  if (!authEnabled) return;

  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    const write = {
      method: req.method,
      host: req.host,
      origin: req.headers.origin,
      fetchSite: req.headers["sec-fetch-site"],
    };
    if (isCrossOriginWrite(write)) {
      if (sendsUploadBody(req)) closeAfterReply(req, reply);
      return reply.code(403).send({ error: CROSS_ORIGIN_REFUSED });
    }
    if (isPublic(req)) return;
    if (hasSession(req)) return;
    if (sendsUploadBody(req)) closeAfterReply(req, reply);
    return reply.code(401).send({ error: "authentication required" });
  });
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  limiter: LoginLimiter = loginLimiter(),
  now: () => number = Date.now,
): Promise<void> {
  app.get("/auth/status", PUBLIC_ROUTE, async (req): Promise<AuthStatus> => {
    return { authEnabled, authenticated: hasSession(req) };
  });

  app.post("/auth/login", PUBLIC_ROUTE, async (req, reply) => {
    if (!authEnabled) return reply.send({ ok: true });
    const client = clientKey(req.ip);
    const waitMs = limiter.retryAfterMs(client, now());
    if (waitMs > 0) {
      reply.header("retry-after", String(Math.ceil(waitMs / 1000)));
      return reply.code(429).send({ error: "too many failed logins; try again later" });
    }
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "password required" });

    if (!checkPassword(parsed.data.password)) {
      limiter.failed(client, now());
      return reply.code(401).send({ error: "invalid password" });
    }
    limiter.succeeded(client);

    reply.header("set-cookie", sessionCookie(issueToken()));
    reply.header("cache-control", "private, no-store");
    return reply.send({ ok: true });
  });

  app.post("/auth/logout", PUBLIC_ROUTE, async (req, reply) => {
    revokeToken(readSessionCookie(req.headers.cookie));
    reply.header("set-cookie", clearCookie());
    return reply.send({ ok: true });
  });
}
