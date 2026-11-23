import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
};

function applySecurityHeaders(url: string, reply: FastifyReply): void {
  reply.headers(SECURITY_HEADERS);
  if (url.startsWith("/auth/")) reply.header("cache-control", "private, no-store");
}

export function registerSecurityHeaders(app: FastifyInstance): void {
  app.addHook("onRequest", async (req, reply) => applySecurityHeaders(req.url, reply));
}

export function frameworkErrors(error: FastifyError, req: FastifyRequest, reply: FastifyReply) {
  applySecurityHeaders(req.url, reply);
  reply.code(error.statusCode ?? 400).send({ error: "bad request" });
}
