import type { Scene } from "./scenes.ts";

export const READY_MS = 30_000;

export const MISSED_READY_MS = 2_000;

interface Waitable {
  locator(selector: string): {
    first(): { waitFor(options: { timeout: number }): Promise<unknown> };
  };
}

export function readyWaiter() {
  const missed = new Set<string>();
  return async (page: Waitable, { route, ready }: Pick<Scene, "route" | "ready">) => {
    const key = `${route} ${ready}`;
    const timeout = missed.has(key) ? MISSED_READY_MS : READY_MS;
    await page
      .locator(ready)
      .first()
      .waitFor({ timeout })
      .catch((err: unknown) => {
        missed.add(key);
        throw err;
      });
  };
}
