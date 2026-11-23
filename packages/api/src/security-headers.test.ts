import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import Fastify from "fastify";
import { registerSecurityHeaders, SECURITY_HEADERS } from "./security-headers";

const app = Fastify();
let base = "";

beforeAll(async () => {
  registerSecurityHeaders(app);
  app.get("/jobs/active", async () => []);
  app.get("/auth/status", async () => ({ ok: true }));
  app.get("/boom", async () => {
    throw new Error("boom");
  });
  base = await app.listen({ host: "127.0.0.1", port: 0 });
});

afterAll(async () => {
  await app.close();
});

describe("registerSecurityHeaders", () => {
  test.each(["/jobs/active", "/auth/status", "/nope", "/boom"])(
    "sets every security header on %s",
    async (path) => {
      const res = await fetch(`${base}${path}`);
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
        expect(res.headers.get(name)).toBe(value);
      }
    },
  );

  test("forbids framing and every resource load for API responses", () => {
    expect(SECURITY_HEADERS["content-security-policy"]).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
    expect(SECURITY_HEADERS["x-frame-options"]).toBe("DENY");
    expect(SECURITY_HEADERS["x-content-type-options"]).toBe("nosniff");
    expect(SECURITY_HEADERS["referrer-policy"]).toBe("no-referrer");
  });

  test("marks /auth/* responses uncacheable and leaves others alone", async () => {
    expect((await fetch(`${base}/auth/status`)).headers.get("cache-control")).toBe(
      "private, no-store",
    );
    expect((await fetch(`${base}/jobs/active`)).headers.get("cache-control")).toBeNull();
  });
});
