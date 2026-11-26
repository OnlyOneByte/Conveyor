import { checkAuth } from "#lib/auth-gate.js";
import type { LayoutLoad } from "./$types";

export const ssr = false;

export const load: LayoutLoad = ({ fetch }) => checkAuth(fetch);
