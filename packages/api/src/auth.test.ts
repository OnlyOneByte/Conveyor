import { afterAll, describe, expect, setSystemTime, test } from "bun:test";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";

const dir = mkdtempSync(join(tmpdir(), "conveyor-api-auth-"));
const keys = ["CONVEYOR_AUTH", "CONVEYOR_PASSWORD", "CONVEYOR_AUTH_SECRET", "DB_PATH", "DATA_DIR"];
const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
Object.assign(process.env, {
  CONVEYOR_AUTH: "enabled",
  CONVEYOR_PASSWORD: "auth-unit-test-password",
  CONVEYOR_AUTH_SECRET: "auth-unit-test-secret-auth-unit-test-secret",
  DB_PATH: join(dir, "conveyor.db"),
  DATA_DIR: dir,
});
const auth = await import("./auth");
const { PUBLIC_ROUTE, registerAuthGuard, registerAuthRoutes } = await import("./routes/auth");
const { openDb } = await import("@conveyor/shared/db");

const payloadOf = (token: string) =>
  JSON.parse(Buffer.from(token.split(".")[0] ?? "", "base64url").toString()) as Record<
    string,
    unknown
  >;

afterAll(() => {
  setSystemTime();
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(dir, { recursive: true, force: true });
});

describe("session tokens", () => {
  test("an issued token verifies until it is revoked", () => {
    const token = auth.issueToken();
    expect(auth.verifyToken(token)).toBe(true);
    auth.revokeToken(token);
    expect(auth.verifyToken(token)).toBe(false);
  });

  test("revoking one token leaves another valid", () => {
    const kept = auth.issueToken();
    auth.revokeToken(auth.issueToken());
    expect(auth.verifyToken(kept)).toBe(true);
  });

  test.each([
    ["no token", undefined],
    ["no signature", "abc"],
    ["a bad signature", `${Buffer.from('{"exp":1}').toString("base64url")}.bad`],
  ])("refuses %s, and revoking it does nothing", (_label, token) => {
    expect(auth.verifyToken(token)).toBe(false);
    auth.revokeToken(token);
  });

  test("refuses a token whose payload was edited after signing", () => {
    const [data, sig] = auth.issueToken().split(".");
    const payload = JSON.parse(Buffer.from(data ?? "", "base64url").toString());
    const edited = Buffer.from(JSON.stringify({ ...payload, exp: payload.exp + 1 })).toString(
      "base64url",
    );
    expect(auth.verifyToken(`${edited}.${sig}`)).toBe(false);
  });
});

describe("passwords and cookies", () => {
  test("checks the configured password only", () => {
    expect(auth.checkPassword("auth-unit-test-password")).toBe(true);
    expect(auth.checkPassword("auth-unit-test-passwore")).toBe(false);
  });

  test("the session cookie is HttpOnly, SameSite=Strict and Secure, and reads back", () => {
    const cookie = auth.sessionCookie("tok.sig");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Secure");
    expect(auth.readSessionCookie(`a=1; ${cookie.split(";")[0]}; b=2`)).toBe("tok.sig");
    expect(auth.readSessionCookie(undefined)).toBeUndefined();
    expect(auth.clearCookie()).toContain("Max-Age=0");
  });
});

describe("the password version", () => {
  test("is an HMAC of the password keyed by the signing secret", () => {
    const expected = createHmac("sha256", "secret-a").update("password:pw").digest("base64url");
    expect(auth.passwordVersion("secret-a", "pw")).toBe(expected);
    expect(auth.passwordVersion("secret-b", "pw")).not.toBe(expected);
    expect(auth.passwordVersion("secret-a", "pw2")).not.toBe(expected);
  });

  test("stays on the server: the cookie carries only exp and sid", () => {
    expect(Object.keys(payloadOf(auth.issueToken())).sort()).toEqual(["exp", "sid"]);
  });

  test("a session row from another password is refused", () => {
    const token = auth.issueToken();
    const { sid } = payloadOf(token);
    openDb().query("UPDATE sessions SET password_version = 'other' WHERE id = ?").run(String(sid));
    expect(auth.verifyToken(token)).toBe(false);
  });
});

describe("session ids and expiry", () => {
  test("each session id is 16 random bytes, never reused", () => {
    const ids = Array.from({ length: 50 }, () => String(payloadOf(auth.issueToken()).sid));
    for (const id of ids) expect(Buffer.from(id, "base64url").length).toBe(auth.SESSION_ID_BYTES);
    expect(auth.SESSION_ID_BYTES).toBe(16);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("the cookie's own exp is enforced even if the row outlives it", () => {
    const token = auth.issueToken();
    const { exp, sid } = payloadOf(token);
    openDb()
      .query("UPDATE sessions SET expires_at = ? WHERE id = ?")
      .run(Number(exp) + 3_600_000, String(sid));
    setSystemTime(new Date(Number(exp) + 1));
    expect(auth.verifyToken(token)).toBe(false);
    setSystemTime();
    expect(auth.verifyToken(token)).toBe(true);
  });
});

describe("the auth guard", () => {
  test("lets only routes marked public through without a session", async () => {
    const app = Fastify();
    registerAuthGuard(app);
    app.get("/open", PUBLIC_ROUTE, async () => ({ ok: true }));
    app.get("/auth/not-marked", async () => ({ ok: true }));
    app.get("/closed", async () => ({ ok: true }));
    const base = await app.listen({ host: "127.0.0.1", port: 0 });
    try {
      const cookie = auth.sessionCookie(auth.issueToken()).split(";")[0] ?? "";
      const codes = async (headers: Record<string, string>) =>
        Promise.all(
          ["/open", "/auth/not-marked", "/closed", "/missing"].map(
            async (path) => (await fetch(`${base}${path}`, { headers })).status,
          ),
        );
      expect(await codes({})).toEqual([200, 401, 401, 401]);
      expect(await codes({ cookie })).toEqual([200, 200, 200, 404]);
    } finally {
      await app.close();
    }
  });
});

describe("the auth routes", () => {
  const calls: string[] = [];
  let waitMs = 0;
  const limiter = {
    retryAfterMs: () => waitMs,
    failed: (client: string) => void calls.push(`failed ${client}`),
    succeeded: (client: string) => void calls.push(`succeeded ${client}`),
  };
  const app = Fastify();
  const ready = registerAuthRoutes(app, limiter, () => 1_000).then(() => app.ready());
  const login = async (body: unknown) => {
    await ready;
    return app.inject({ method: "POST", url: "/auth/login", payload: body as object });
  };
  const cookieOf = (setCookie: unknown) => String(setCookie).split(";")[0] ?? "";

  afterAll(() => app.close());

  test("the right password sets an uncacheable session cookie that /auth/status accepts", async () => {
    calls.length = 0;
    const res = await login({ password: "auth-unit-test-password" });
    expect(res.statusCode).toBe(200);
    expect(res.json<unknown>()).toEqual({ ok: true });
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(calls).toEqual(["succeeded 127.0.0.1"]);
    const cookie = cookieOf(res.headers["set-cookie"]);
    const status = await app.inject({ url: "/auth/status", headers: { cookie } });
    expect(status.json<unknown>()).toEqual({ authEnabled: true, authenticated: true });
    expect((await app.inject({ url: "/auth/status" })).json<unknown>()).toEqual({
      authEnabled: true,
      authenticated: false,
    });
  });

  test("a wrong password is a 401 that the limiter counts, and sets no cookie", async () => {
    calls.length = 0;
    const res = await login({ password: "auth-unit-test-passwore" });
    expect(res.statusCode).toBe(401);
    expect(res.json<unknown>()).toEqual({ error: "invalid password" });
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(calls).toEqual(["failed 127.0.0.1"]);
  });

  test.each([{}, { password: "" }, { password: "x".repeat(513) }])(
    "a body without a usable password is a 400: %j",
    async (body) => {
      const res = await login(body);
      expect(res.statusCode).toBe(400);
      expect(res.json<unknown>()).toEqual({ error: "password required" });
    },
  );

  test("a limited client gets a 429 with retry-after before its password is checked", async () => {
    calls.length = 0;
    waitMs = 1_500;
    const res = await login({ password: "auth-unit-test-password" });
    waitMs = 0;
    expect(res.statusCode).toBe(429);
    expect(res.headers["retry-after"]).toBe("2");
    expect(calls).toEqual([]);
  });

  test("a limited client's wrong password is the same 429, and records no failure", async () => {
    calls.length = 0;
    waitMs = 1_500;
    const res = await login({ password: "auth-unit-test-passwore" });
    waitMs = 0;
    expect(res.statusCode).toBe(429);
    expect(res.json<unknown>()).toEqual({ error: "too many failed logins; try again later" });
    expect(res.headers["retry-after"]).toBe("2");
    expect(calls).toEqual([]);
  });

  test("logout revokes the session and clears the cookie", async () => {
    const cookie = cookieOf(
      (await login({ password: "auth-unit-test-password" })).headers["set-cookie"],
    );
    const res = await app.inject({ method: "POST", url: "/auth/logout", headers: { cookie } });
    expect(res.json<unknown>()).toEqual({ ok: true });
    expect(String(res.headers["set-cookie"])).toContain("Max-Age=0");
    expect(auth.verifyToken(cookie.split("=")[1])).toBe(false);
  });
});
