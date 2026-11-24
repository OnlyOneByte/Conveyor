import { type AuthStatus, fetchAuthStatus } from "#lib/api.js";
import type { LayoutLoad } from "./$types";

export const ssr = false;

const UNREACHABLE: AuthStatus = { authEnabled: false, authenticated: false };

export const load: LayoutLoad = async ({ fetch }) => ({
  auth: await fetchAuthStatus(fetch).catch(() => UNREACHABLE),
});
