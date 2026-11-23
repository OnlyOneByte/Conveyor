import type { Handle } from "@sveltejs/kit/hooks";
import { withSocketSources } from "./lib/csp";

export const handle: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  const csp = response.headers.get("content-security-policy");
  if (csp) response.headers.set("content-security-policy", withSocketSources(csp, event.url.host));
  return response;
};
