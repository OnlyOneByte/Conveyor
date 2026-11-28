import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  dbCreateSession,
  dbDeleteSession,
  dbSessionPasswordVersion,
  openDb,
} from "@conveyor/shared/db";
import { AuthConfigError, DISABLED_WARNING, resolveAuthConfig } from "./auth-config.js";

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
const SESSION_TTL_MS = config.sessionTtlMs;
export const SESSION_ID_BYTES = 16;

export const passwordVersion = (secret: string, password: string): string =>
  createHmac("sha256", secret).update(`password:${password}`).digest("base64url");

const PASSWORD_VERSION = passwordVersion(signingKey, PASSWORD);

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
  sid: string;
}

export function issueToken(): string {
  const now = Date.now();
  const payload: TokenPayload = {
    exp: now + SESSION_TTL_MS,
    sid: randomBytes(SESSION_ID_BYTES).toString("base64url"),
  };
  dbCreateSession(
    openDb(),
    { id: payload.sid, expiresAt: payload.exp, passwordVersion: PASSWORD_VERSION },
    now,
  );
  const data = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", signingKey).update(data).digest("base64url");
  return `${data}.${sig}`;
}

function signedPayload(token: string | undefined): TokenPayload | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const data = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = createHmac("sha256", signingKey).update(data).digest("base64url");
  if (!constantTimeEqual(sig, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString()) as Partial<TokenPayload>;
    if (typeof payload.exp !== "number" || typeof payload.sid !== "string") return null;
    return { exp: payload.exp, sid: payload.sid };
  } catch {
    return null;
  }
}

export function verifyToken(token: string | undefined): boolean {
  const payload = signedPayload(token);
  if (!payload) return false;
  const now = Date.now();
  if (payload.exp < now) return false;
  const version = dbSessionPasswordVersion(openDb(), payload.sid, now);
  return version !== null && constantTimeEqual(version, PASSWORD_VERSION);
}

export function revokeToken(token: string | undefined): void {
  const payload = signedPayload(token);
  if (payload) dbDeleteSession(openDb(), payload.sid);
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
