import type { AuthStatus } from "@conveyor/shared/auth-status";
import { API } from "./api.js";
import { statusError, Unreachable, unreachable } from "./http-error.js";

export const AUTH_TIMEOUT_MS = 8000;

export interface Down {
  hint: string;
  detail: string | null;
}

export interface Gate {
  auth: AuthStatus | null;
  down: Down | null;
}

const hint = (e: unknown) => {
  if (e instanceof Unreachable) return "Check that it's running, then try again.";
  if (unreachable(e)) return "Check your connection, then try again.";
  return "Conveyor hit a problem checking your sign-in. Try again in a moment.";
};

const timedOut = (e: unknown) => e instanceof DOMException && e.name === "TimeoutError";

export function authStatus(body: unknown): AuthStatus | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  if (Object.keys(body).length !== 2) return null;
  const own = (key: string): unknown => (Object.hasOwn(body, key) ? Reflect.get(body, key) : null);
  const authEnabled = own("authEnabled");
  const authenticated = own("authenticated");
  if (typeof authEnabled !== "boolean" || typeof authenticated !== "boolean") return null;
  return { authEnabled, authenticated };
}

export async function fetchAuthStatus(
  fetchFn: typeof fetch = fetch,
  timeoutMs = AUTH_TIMEOUT_MS,
): Promise<AuthStatus> {
  const late = (e: unknown) => {
    if (timedOut(e)) return new Unreachable(`GET /auth/status timed out after ${timeoutMs} ms`);
  };
  const r = await fetchFn(`${API}/auth/status`, { signal: AbortSignal.timeout(timeoutMs) }).catch(
    (e: unknown) => {
      throw late(e) ?? e;
    },
  );
  if (!r.ok) throw statusError(r, "GET /auth/status");
  const body: unknown = await r.json().catch((e: unknown) => {
    const timeout = late(e);
    if (timeout) throw timeout;
  });
  const status = authStatus(body);
  if (!status) throw new Error("GET /auth/status answered in an unexpected shape");
  return status;
}

export const checkAuth = (fetchFn: typeof fetch, timeoutMs = AUTH_TIMEOUT_MS): Promise<Gate> =>
  fetchAuthStatus(fetchFn, timeoutMs).then(
    (auth) => ({ auth, down: null }),
    (e: unknown) => ({
      auth: null,
      down: { hint: hint(e), detail: (e instanceof Error ? e.message : String(e)) || null },
    }),
  );
