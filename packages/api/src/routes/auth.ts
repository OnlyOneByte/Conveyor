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
  type Role,
} from "../auth.js";

const loginSchema = z.object({ password: z.string().min(1).max(512) });

/** Resolve the caller's role from the session cookie (null = anonymous). */
function roleOf(req: FastifyRequest): Role | null {
  return verifyToken(readSessionCookie(req.headers.cookie));
}

/**
 * Path-based access gate. Mirrors the angryang.dev lesson: the gated-path
 * definition lives in ONE place so a route can't silently fall outside the
 * protected tree. Rules (when auth is enabled):
 *   - /admin/*  and /jobs-history  → require role "admin"
 *   - everything else that mutates/reads app data → require any valid session
 *   - /health and /auth/* are always public (login must be reachable)
 */
const PUBLIC_PREFIXES = ["/health", "/auth/"];
const ADMIN_PREFIXES = ["/admin", "/jobs-history"];

function isPublic(url: string): boolean {
  return PUBLIC_PREFIXES.some((p) => url === p || url.startsWith(p));
}
function needsAdmin(url: string): boolean {
  return ADMIN_PREFIXES.some((p) => url === p || url.startsWith(p));
}

export function registerAuthGuard(app: FastifyInstance): void {
  if (!authEnabled) return; // open mode — no gate (warned at boot)

  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    const url = req.url.split("?")[0];
    if (isPublic(url)) return;

    const role = roleOf(req);
    if (!role) return reply.code(401).send({ error: "authentication required" });
    if (needsAdmin(url) && role !== "admin") {
      return reply.code(403).send({ error: "admin access required" });
    }
  });
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  // Whether the client must show a login screen, and (cheaply) whether an admin
  // password is even configured — lets the UI hide the admin entry otherwise.
  app.get("/auth/status", async (req) => {
    const role = roleOf(req);
    return { authEnabled, role: role ?? null, authenticated: !!role };
  });

  app.post("/auth/login", async (req, reply) => {
    if (!authEnabled) return reply.send({ ok: true, role: "user" }); // nothing to log into
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "password required" });

    const role = checkPassword(parsed.data.password);
    if (!role) return reply.code(401).send({ error: "invalid password" });

    reply.header("set-cookie", sessionCookie(issueToken(role)));
    // Gated responses must not be cached/cross-served (angryang.dev lesson).
    reply.header("cache-control", "private, no-store");
    return reply.send({ ok: true, role });
  });

  app.post("/auth/logout", async (_req, reply) => {
    reply.header("set-cookie", clearCookie());
    return reply.send({ ok: true });
  });
}
