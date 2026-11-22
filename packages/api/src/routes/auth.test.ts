import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { createHmac } from "node:crypto";
import Fastify from "fastify";

const PASSWORD = "correct horse battery";
const SECRET = "s".repeat(64);
const previous = {
  mode: process.env.CONVEYOR_AUTH,
  password: process.env.CONVEYOR_PASSWORD,
  secret: process.env.CONVEYOR_AUTH_SECRET,
  insecure: process.env.CONVEYOR_COOKIE_INSECURE,
};
process.env.CONVEYOR_AUTH = "enabled";
process.env.CONVEYOR_PASSWORD = PASSWORD;
process.env.CONVEYOR_AUTH_SECRET = SECRET;
delete process.env.CONVEYOR_COOKIE_INSECURE;

const auth = await import("../auth.js");
const { registerAuthGuard, registerAuthRoutes } = await import("./auth.js");

const app = Fastify();
let base = "";

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

const login = (body: unknown) =>
  fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

function signed(payload: string): string {
  const data = Buffer.from(payload).toString("base64url");
  const sig = createHmac("sha256", SECRET).update(data).digest("base64url");
  return `${data}.${sig}`;
}

const cookieFrom = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

beforeAll(async () => {
  app.get("/health", async () => ({ ok: true }));
  registerAuthGuard(app);
  await registerAuthRoutes(app);
  app.get("/catalog/printers", async () => [{ id: "p" }]);
  base = await app.listen({ host: "127.0.0.1", port: 0 });
});

afterAll(async () => {
  await app.close();
  restore("CONVEYOR_AUTH", previous.mode);
  restore("CONVEYOR_PASSWORD", previous.password);
  restore("CONVEYOR_AUTH_SECRET", previous.secret);
  restore("CONVEYOR_COOKIE_INSECURE", previous.insecure);
});

describe("auth guard", () => {
  test("refuses a gated route without a session", async () => {
    const res = await fetch(`${base}/catalog/printers`);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "authentication required" });
  });

  test("serves a gated route to a caller with a fresh session cookie", async () => {
    const cookie = `conveyor_session=${auth.issueToken()}`;
    const res = await fetch(`${base}/catalog/printers`, { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: "p" }]);
  });

  test("lets /health and its query string through without a session", async () => {
    const res = await fetch(`${base}/health?probe=1`);
    expect(res.status).toBe(200);
  });

  test("refuses a session cookie whose signature was tampered with", async () => {
    const [data] = auth.issueToken().split(".");
    const cookie = `conveyor_session=${data}.forged`;
    const res = await fetch(`${base}/catalog/printers`, { headers: { cookie } });
    expect(res.status).toBe(401);
  });
});

describe("POST /auth/login", () => {
  test("a wrong password is a 401 and sets no cookie", async () => {
    const res = await login({ password: "wrong password!" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid password" });
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  test.each([{}, { password: "" }, { password: 7 }])(
    "a malformed body %p is a 400",
    async (body) => {
      const res = await login(body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "password required" });
    },
  );

  test("the right password sets a hardened, uncacheable session cookie", async () => {
    const res = await login({ password: PASSWORD });
    expect(res.status).toBe(200);
    const header = res.headers.get("set-cookie") ?? "";
    expect(header).toMatch(/^conveyor_session=[^;]+\./);
    for (const attr of ["HttpOnly", "SameSite=Strict", "Path=/", "Max-Age=43200", "Secure"]) {
      expect(header.split("; ")).toContain(attr);
    }
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  test("the cookie it sets opens gated routes and flips /auth/status", async () => {
    const cookie = cookieFrom(await login({ password: PASSWORD }));
    const gated = await fetch(`${base}/catalog/printers`, { headers: { cookie } });
    expect(gated.status).toBe(200);
    const status = await fetch(`${base}/auth/status`, { headers: { cookie } });
    expect(await status.json()).toEqual({ authEnabled: true, authenticated: true });
  });
});

describe("GET /auth/status", () => {
  test("is public and reports an anonymous caller as unauthenticated", async () => {
    const res = await fetch(`${base}/auth/status`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ authEnabled: true, authenticated: false });
  });
});

describe("POST /auth/logout", () => {
  test("expires the session cookie immediately", async () => {
    const res = await fetch(`${base}/auth/logout`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBe(
      "conveyor_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0; Secure",
    );
  });
});

describe("session tokens", () => {
  test("a token is valid until its expiry and refused after it", () => {
    const issuedAt = 1_000_000;
    const now = spyOn(Date, "now").mockReturnValue(issuedAt);
    const token = auth.issueToken();
    now.mockReturnValue(issuedAt + 12 * 60 * 60 * 1000);
    expect(auth.verifyToken(token)).toBe(true);
    now.mockReturnValue(issuedAt + 12 * 60 * 60 * 1000 + 1);
    expect(auth.verifyToken(token)).toBe(false);
    now.mockRestore();
  });

  test.each([undefined, "", "no-dot-here", "a.b.c"])("refuses the malformed token %p", (token) => {
    expect(auth.verifyToken(token)).toBe(false);
  });

  test("refuses a correctly signed payload that is not JSON", () => {
    expect(auth.verifyToken(signed("not json"))).toBe(false);
  });

  test("refuses a correctly signed payload without a numeric expiry", () => {
    expect(auth.verifyToken(signed(JSON.stringify({ exp: "never" })))).toBe(false);
  });

  test("accepts a correctly signed payload with a future expiry", () => {
    expect(auth.verifyToken(signed(JSON.stringify({ exp: Date.now() + 60_000 })))).toBe(true);
  });
});

describe("checkPassword", () => {
  test("matches only the configured password", () => {
    expect(auth.checkPassword(PASSWORD)).toBe(true);
    expect(auth.checkPassword(`${PASSWORD} `)).toBe(false);
    expect(auth.checkPassword("")).toBe(false);
  });
});

describe("readSessionCookie", () => {
  test("finds the session among other cookies and keeps '=' inside its value", () => {
    expect(auth.readSessionCookie("theme=dark; conveyor_session=abc=.sig; lang=en")).toBe(
      "abc=.sig",
    );
  });

  test.each([undefined, "", "theme=dark"])("returns undefined for %p", (header) => {
    expect(auth.readSessionCookie(header)).toBeUndefined();
  });
});
