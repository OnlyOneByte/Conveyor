import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import {
  authEnabled,
  checkPassword,
  issueToken,
  verifyToken,
  sessionCookie,
  clearCookie,
  readSessionCookie,
} from "../auth.js";

const loginSchema = z.object({ password: z.string().min(1).max(512) });

/** True when the caller presents a valid session cookie. */
function hasSession(req: FastifyRequest): boolean {
  return verifyToken(readSessionCookie(req.headers.cookie));
}

/**
 * Path-based access gate. Mirrors the angryang.dev lesson: the gated-path
 * definition lives in ONE place so a route can't silently fall outside the
 * protected tree. Rules (when auth is enabled):
 *   - /health and /auth/* are always public (login must be reachable)
 *   - everything else requires a valid session
 *
 * One tier only — holding the password grants the whole app, catalog included. See
 * auth.ts for why the former elevated role was removed.
 */
const PUBLIC_PREFIXES = ["/health", "/auth/"];

function isPublic(url: string): boolean {
  return PUBLIC_PREFIXES.some((p) => url === p || url.startsWith(p));
}

export function registerAuthGuard(app: FastifyInstance): void {
  if (!authEnabled) return; // open mode — no gate (warned at boot)

  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    const url = req.url.split("?")[0];
    if (isPublic(url)) return;
    if (!hasSession(req)) return reply.code(401).send({ error: "authentication required" });
  });
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  // Whether the client must show a login screen.
  app.get("/auth/status", async (req) => {
    return { authEnabled, authenticated: hasSession(req) };
  });

  app.post("/auth/login", async (req, reply) => {
    if (!authEnabled) return reply.send({ ok: true }); // nothing to log into
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "password required" });

    if (!checkPassword(parsed.data.password)) {
      return reply.code(401).send({ error: "invalid password" });
    }

    reply.header("set-cookie", sessionCookie(issueToken()));
    // Gated responses must not be cached/cross-served (angryang.dev lesson).
    reply.header("cache-control", "private, no-store");
    return reply.send({ ok: true });
  });

  app.post("/auth/logout", async (_req, reply) => {
    reply.header("set-cookie", clearCookie());
    return reply.send({ ok: true });
  });
}
