import type { BrowserContext, Route } from "playwright";

export const HISTORY_EPOCH = Date.UTC(2026, 0, 1, 12, 0, 0);

export function pinHistory(body: unknown): unknown {
  if (!Array.isArray(body)) return body;
  return body.map((entry: unknown, i) => {
    if (typeof entry !== "object" || entry === null) return entry;
    const n = body.length - i;
    const at = HISTORY_EPOCH + n * 60_000;
    return {
      ...entry,
      id: `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`,
      createdAt: at,
      updatedAt: at,
    };
  });
}

export function pinHistoryEntry(body: unknown): unknown {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return body;
  return { ...body, createdAt: HISTORY_EPOCH, updatedAt: HISTORY_EPOCH };
}

export const isHistoryList = (url: URL): boolean => url.pathname === "/jobs-history";

export const isHistoryEntry = (url: URL): boolean => /^\/jobs-history\/[^/]+$/.test(url.pathname);

const fulfillWith = (pin: (body: unknown) => unknown) => async (route: Route) => {
  const response = await route.fetch();
  if (!response.ok()) return route.fulfill({ response });
  await route.fulfill({ response, json: pin(await response.json()) });
};

export const fulfillPinned = fulfillWith(pinHistory);

export const fulfillPinnedEntry = fulfillWith(pinHistoryEntry);

export async function pinHistoryRoute(context: BrowserContext): Promise<void> {
  await context.route(isHistoryList, fulfillPinned);
  await context.route(isHistoryEntry, fulfillPinnedEntry);
}
