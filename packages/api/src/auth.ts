import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { AuthConfigError, DISABLED_WARNING, resolveAuthConfig } from "./auth-config.js";

const SESSION_TTL_MS = Number(process.env.CONVEYOR_SESSION_TTL_MS ?? 12 * 60 * 60 * 1000);
const COOKIE_NAME = "conveyor_session";
const COOKIE_INSECURE = process.env.CONVEYOR_COOKIE_INSECURE === "1";

function loadAuthConfig() {
  try {
    return resolveAuthConfig(process.env, () => randomBytes(32).toString("hex"));
  } catch (error) {
    if (!(error instanceof AuthConfigError)) throw error;
    console.error(error.message);
    process.exit(1);
  }
}

const config = loadAuthConfig();
const PASSWORD = config.password;
const signingKey = config.secret;

export const authEnabled = config.enabled;

if (!authEnabled) console.warn(DISABLED_WARNING);

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}

function constantTimeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function checkPassword(input: string): boolean {
  return PASSWORD.length > 0 && constantTimeEqual(input, PASSWORD);
}

type EpochMs = number;

interface TokenPayload {
  exp: EpochMs;
}

export function issueToken(): string {
  const payload: TokenPayload = { exp: Date.now() + SESSION_TTL_MS };
  const data = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", signingKey).update(data).digest("base64url");
  return `${data}.${sig}`;
}

export function verifyToken(token: string | undefined): boolean {
  if (!token) return false;
  const dot = token.lastIndexOf(".");
  if (dot < 0) return false;
  const data = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = createHmac("sha256", signingKey).update(data).digest("base64url");
  if (!constantTimeEqual(sig, expected)) return false;

  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString()) as TokenPayload;
    return typeof payload.exp === "number" && payload.exp >= Date.now();
  } catch {
    return false;
  }
}

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

export function clearCookie(): string {
  const attrs = [`${COOKIE_NAME}=`, "HttpOnly", "SameSite=Strict", "Path=/", "Max-Age=0"];
  if (!COOKIE_INSECURE) attrs.push("Secure");
  return attrs.join("; ");
}

export function readSessionCookie(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE_NAME) return v.join("=");
  }
  return undefined;
}
