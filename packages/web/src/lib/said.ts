const STATUS_LINE = /^(GET|POST|PUT|DELETE) \S+ \d{3}$/;

export const UNREACHABLE = "Can't reach Conveyor. Check your connection, then try again.";
export const FAILED = "Conveyor couldn't do that just now. Try again.";

export function serverSaid(e: unknown): string | null {
  if (e instanceof TypeError) return null;
  const text = (e instanceof Error ? e.message : String(e)).trim();
  return text && !STATUS_LINE.test(text) ? text : null;
}

export const said = (e: unknown) => serverSaid(e) ?? (e instanceof TypeError ? UNREACHABLE : FAILED);

export function couldnt(what: string, e: unknown): string {
  const why = serverSaid(e);
  if (why) return `Couldn't ${what}: ${why}`;
  return `Couldn't ${what}. ${e instanceof TypeError ? "Check your connection, then try again." : "Try again."}`;
}
