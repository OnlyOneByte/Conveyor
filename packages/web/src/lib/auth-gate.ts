import { type AuthStatus, fetchAuthStatus } from "./api.js";
import { Unreachable, unreachable } from "./http-error.js";
import { detailOf } from "./said.js";

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

export const checkAuth = (fetchFn: typeof fetch): Promise<Gate> =>
  fetchAuthStatus(fetchFn).then(
    (auth) => ({ auth, down: null }),
    (e: unknown) => ({ auth: null, down: { hint: hint(e), detail: detailOf(e) } }),
  );
