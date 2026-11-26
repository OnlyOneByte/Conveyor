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

export async function fetchAuthStatus(
  fetchFn: typeof fetch = fetch,
  timeoutMs = AUTH_TIMEOUT_MS,
): Promise<AuthStatus> {
  const schema = import("@conveyor/shared/auth-status");
  schema.catch(() => undefined);
  const r = await fetchFn(`${API}/auth/status`, { signal: AbortSignal.timeout(timeoutMs) }).catch(
    (e: unknown) => {
      if (timedOut(e)) throw new Unreachable(`GET /auth/status timed out after ${timeoutMs} ms`);
      throw e;
    },
  );
  if (!r.ok) throw statusError(r, "GET /auth/status");
  const body: unknown = await r.json().catch(() => undefined);
  const parsed = (await schema).authStatusSchema.safeParse(body);
  if (!parsed.success) throw new Error("GET /auth/status answered in an unexpected shape");
  return parsed.data;
}

export const checkAuth = (fetchFn: typeof fetch, timeoutMs = AUTH_TIMEOUT_MS): Promise<Gate> =>
  fetchAuthStatus(fetchFn, timeoutMs).then(
    (auth) => ({ auth, down: null }),
    (e: unknown) => ({
      auth: null,
      down: { hint: hint(e), detail: (e instanceof Error ? e.message : String(e)) || null },
    }),
  );
