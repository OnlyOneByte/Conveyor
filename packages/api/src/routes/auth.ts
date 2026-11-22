import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  authEnabled,
  checkPassword,
  clearCookie,
  issueToken,
  readSessionCookie,
  sessionCookie,
  verifyToken,
} from "../auth.js";
import { type LoginLimiter, loginLimiter } from "../login-limit.js";

const loginSchema = z.object({ password: z.string().min(1).max(512) });

function hasSession(req: FastifyRequest): boolean {
  return verifyToken(readSessionCookie(req.headers.cookie));
}

const PUBLIC_PATHS = ["/health"];
const PUBLIC_PREFIXES = ["/auth/"];

function isPublic(url: string): boolean {
  return PUBLIC_PATHS.includes(url) || PUBLIC_PREFIXES.some((p) => url.startsWith(p));
}

export function registerAuthGuard(app: FastifyInstance): void {
  if (!authEnabled) return;

  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    const url = req.url.split("?")[0];
    if (isPublic(url)) return;
    if (!hasSession(req)) return reply.code(401).send({ error: "authentication required" });
  });
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  limiter: LoginLimiter = loginLimiter(),
  now: () => number = Date.now,
): Promise<void> {
  app.get("/auth/status", async (req) => {
    return { authEnabled, authenticated: hasSession(req) };
  });

  app.post("/auth/login", async (req, reply) => {
    if (!authEnabled) return reply.send({ ok: true });
    const waitMs = limiter.retryAfterMs(req.ip, now());
    if (waitMs > 0) {
      reply.header("retry-after", String(Math.ceil(waitMs / 1000)));
      return reply.code(429).send({ error: "too many failed logins; try again later" });
    }
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "password required" });

    if (!checkPassword(parsed.data.password)) {
      limiter.failed(req.ip, now());
      return reply.code(401).send({ error: "invalid password" });
    }
    limiter.succeeded(req.ip);

    reply.header("set-cookie", sessionCookie(issueToken()));
    reply.header("cache-control", "private, no-store");
    return reply.send({ ok: true });
  });

  app.post("/auth/logout", async (_req, reply) => {
    reply.header("set-cookie", clearCookie());
    return reply.send({ ok: true });
  });
}
