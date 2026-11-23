import type { BrowserContext } from "playwright";

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

export async function pinHistoryRoute(context: BrowserContext): Promise<void> {
  await context.route(
    (url) => url.pathname === "/jobs-history",
    async (route) => {
      const response = await route.fetch();
      if (!response.ok()) return route.fulfill({ response });
      await route.fulfill({ response, json: pinHistory(await response.json()) });
    },
  );
}
