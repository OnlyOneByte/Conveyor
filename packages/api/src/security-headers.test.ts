import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { AddressInfo } from "node:net";
import Fastify from "fastify";
import { rawGet } from "../test/helpers/raw-http.ts";
import { frameworkErrors, registerSecurityHeaders, SECURITY_HEADERS } from "./security-headers";

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

describe("frameworkErrors", () => {
  const strict = Fastify({ frameworkErrors });
  let port = 0;

  beforeAll(async () => {
    registerSecurityHeaders(strict);
    strict.get("/jobs/:id", async () => ({ ok: true }));
    await strict.listen({ host: "127.0.0.1", port: 0 });
    port = (strict.server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await strict.close();
  });

  test.each([
    ["/jobs/%E0%A4%A", "none"],
    ["/auth/%E0%A4%A", "private, no-store"],
  ])(
    "answers the undecodable URL %s with a JSON 400 and every security header",
    async (path, cacheControl) => {
      const res = await rawGet(port, path);
      expect(res.status).toBe(400);
      expect(res.headers["content-type"]).toStartWith("application/json");
      expect(JSON.parse(res.body)).toEqual({ error: "bad request" });
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
        expect(res.headers[name]).toBe(value);
      }
      expect(res.headers["cache-control"] ?? "none").toBe(cacheControl);
    },
  );
});
