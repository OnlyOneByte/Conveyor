import { unreachable } from "./http-error.js";

const STATUS_LINE = /^(GET|POST|PUT|PATCH|DELETE) \S+ \d{3}$/;
const STOCK = new Set([
  "Internal Server Error",
  "Bad Gateway",
  "Service Unavailable",
  "Gateway Timeout",
]);

export const UNREACHABLE = "Can't reach Conveyor. Check your connection, then try again.";
export const FAILED = "Conveyor couldn't do that just now. Try again.";
export const NOT_LOADED = "Conveyor hit a problem loading this. Try again in a moment.";

export function serverSaid(e: unknown): string | null {
  if (unreachable(e)) return null;
  const text = (e instanceof Error ? e.message : String(e)).trim();
  return text && !STATUS_LINE.test(text) && !STOCK.has(text) ? text : null;
}

export const said = (e: unknown) => serverSaid(e) ?? (unreachable(e) ? UNREACHABLE : FAILED);

export const saidOnLoad = (e: unknown) =>
  serverSaid(e) ?? (unreachable(e) ? UNREACHABLE : NOT_LOADED);

export function couldnt(what: string, e: unknown): string {
  const why = serverSaid(e);
  if (why) return `Couldn't ${what}: ${why}`;
  return `Couldn't ${what}. ${unreachable(e) ? "Can't reach Conveyor. Check your connection, then try again." : "Try again."}`;
}
