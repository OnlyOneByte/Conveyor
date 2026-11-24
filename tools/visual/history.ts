import type { Route } from "playwright";

export const HISTORY_EPOCH = Date.UTC(2026, 0, 1, 12, 0, 0);

export const CAPTURE_NOW = HISTORY_EPOCH + 60 * 60_000;

const TIME_FIELDS = ["createdAt", "updatedAt"] as const;

function pinTimes(entry: object, at: number): Record<string, unknown> {
  const pinned: Record<string, unknown> = { ...entry };
  for (const field of TIME_FIELDS) if (field in entry) pinned[field] = at;
  return pinned;
}

export function pinHistory(body: unknown): unknown {
  if (!Array.isArray(body)) return body;
  return body.map((entry: unknown, i) => {
    if (typeof entry !== "object" || entry === null) return entry;
    const n = body.length - i;
    return {
      ...pinTimes(entry, HISTORY_EPOCH + n * 60_000),
      id: `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`,
    };
  });
}

export function pinHistoryEntry(body: unknown): unknown {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return body;
  return pinTimes(body, HISTORY_EPOCH);
}

export const isHistoryList = (url: URL): boolean => url.pathname === "/api/jobs-history";

export const isHistoryEntry = (url: URL): boolean =>
  /^\/api\/jobs-history\/[^/]+$/.test(url.pathname);

interface Fetched {
  ok(): boolean;
  json(): Promise<unknown>;
}

interface PinnableRoute<R extends Fetched> {
  fetch(): Promise<R>;
  fulfill(options: { response?: R; json?: unknown }): Promise<unknown>;
}

async function pinOne<R extends Fetched>(route: PinnableRoute<R>, pin: (body: unknown) => unknown) {
  const response = await route.fetch();
  if (!response.ok()) return route.fulfill({ response });
  await route.fulfill({ response, json: pin(await response.json()) });
}

const fulfillWith =
  (pin: (body: unknown) => unknown) =>
  <R extends Fetched>(route: PinnableRoute<R>) =>
    pinOne(route, pin).catch(() => undefined);

export const fulfillPinned = fulfillWith(pinHistory);

export const fulfillPinnedEntry = fulfillWith(pinHistoryEntry);

type Handler = (route: Route) => Promise<unknown>;

export async function pinHistoryRoute(context: {
  route(match: (url: URL) => boolean, handler: Handler): Promise<unknown>;
}): Promise<void> {
  await context.route(isHistoryList, fulfillPinned);
  await context.route(isHistoryEntry, fulfillPinnedEntry);
}
