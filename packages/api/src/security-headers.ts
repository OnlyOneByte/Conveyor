import type { FastifyInstance } from "fastify";

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
};

export function registerSecurityHeaders(app: FastifyInstance): void {
  app.addHook("onRequest", async (req, reply) => {
    reply.headers(SECURITY_HEADERS);
    if (req.url.startsWith("/auth/")) reply.header("cache-control", "private, no-store");
  });
}
