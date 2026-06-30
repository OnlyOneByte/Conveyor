import { createHmac, createHash, timingSafeEqual, randomBytes } from "node:crypto";

/**
 * Shared-password auth with an HMAC-signed session cookie (SPEC decision: Auth A).
 *
 * Security model, grounded in ARCC "Secure Cookie Handling":
 *  - The cookie is `HttpOnly` (no JS access), `Secure` (HTTPS-only — Caddy
 *    terminates TLS in prod), `SameSite=Strict` (same-origin app, CSRF-safe),
 *    `Path=/`, no `Domain`, and expires in 12h.
 *  - Cookie *attributes* are not trusted for the auth decision; the HMAC
 *    signature over {role, exp} is. A tampered/expired token verifies to null.
 *  - The signing key + passwords come from the environment, never hardcoded or
 *    committed. Passwords are compared in constant time (sha256 + timingSafeEqual).
 *
 * Auth is OFF unless CONVEYOR_PASSWORD is set — keeps local dev and a trusted-LAN
 * deployment frictionless (opt-in), with a loud warning when running open. Set a
 * second CONVEYOR_ADMIN_PASSWORD to gate the /admin surface with an elevated role.
 */
export type Role = "user" | "admin";

const PASSWORD = process.env.CONVEYOR_PASSWORD ?? "";
const ADMIN_PASSWORD = process.env.CONVEYOR_ADMIN_PASSWORD ?? "";
const SESSION_TTL_MS = Number(process.env.CONVEYOR_SESSION_TTL_MS ?? 12 * 60 * 60 * 1000); // 12h
const COOKIE_NAME = "conveyor_session";
// Secure by default; only disable for local plain-HTTP testing (never in prod).
const COOKIE_INSECURE = process.env.CONVEYOR_COOKIE_INSECURE === "1";

export const authEnabled = PASSWORD.length > 0;

// Signing key: required when auth is on. If absent, mint an ephemeral one (so we
// never run unsigned) and warn that sessions won't survive a restart.
let signingKey = process.env.CONVEYOR_AUTH_SECRET ?? "";
if (authEnabled && !signingKey) {
  signingKey = randomBytes(32).toString("hex");
  console.warn(
    "[auth] CONVEYOR_AUTH_SECRET not set — using an ephemeral signing key; sessions reset on restart.",
  );
}
if (!authEnabled) {
  console.warn(
    "[auth] CONVEYOR_PASSWORD not set — auth is DISABLED (open). Set it to require a password (friends-only deployments).",
  );
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}

/** Constant-time string equality via fixed-length digests (avoids length leak). */
function constantTimeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Returns the granted role for a submitted password, or null if it matches none. */
export function checkPassword(input: string): Role | null {
  if (ADMIN_PASSWORD && constantTimeEqual(input, ADMIN_PASSWORD)) return "admin";
  if (PASSWORD && constantTimeEqual(input, PASSWORD)) return "user";
  return null;
}

interface TokenPayload {
  role: Role;
  exp: number; // epoch ms
}

export function issueToken(role: Role): string {
  const payload: TokenPayload = { role, exp: Date.now() + SESSION_TTL_MS };
  const data = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", signingKey).update(data).digest("base64url");
  return `${data}.${sig}`;
}

/** Verify signature + expiry; returns the role or null. */
export function verifyToken(token: string | undefined): Role | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const data = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = createHmac("sha256", signingKey).update(data).digest("base64url");
  // Compare as fixed-length sha256 digests so a length mismatch can't short-circuit.
  if (!constantTimeEqual(sig, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString()) as TokenPayload;
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    if (payload.role !== "user" && payload.role !== "admin") return null;
    return payload.role;
  } catch {
    return null;
  }
}

/** Build the Set-Cookie header value for a freshly-issued session. */
export function sessionCookie(token: string): string {
  const attrs = [
    `${COOKIE_NAME}=${token}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (!COOKIE_INSECURE) attrs.push("Secure");
  return attrs.join("; ");
}

/** Set-Cookie value that immediately clears the session. */
export function clearCookie(): string {
  const attrs = [`${COOKIE_NAME}=`, "HttpOnly", "SameSite=Strict", "Path=/", "Max-Age=0"];
  if (!COOKIE_INSECURE) attrs.push("Secure");
  return attrs.join("; ");
}

/** Pull the session token out of a Cookie header (no cookie-parser dep). */
export function readSessionCookie(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE_NAME) return v.join("=");
  }
  return undefined;
}
