import { describe, expect, test } from "bun:test";
import { MISSED_READY_MS, READY_MS, readyWaiter } from "./ready.ts";

function fakePage(found: (selector: string) => boolean) {
  const waits: number[] = [];
  const page = {
    locator: (selector: string) => ({
      first: () => ({
        waitFor: async ({ timeout }: { timeout: number }) => {
          waits.push(timeout);
          if (!found(selector)) throw new Error(`Timeout ${timeout}ms exceeded`);
        },
      }),
    }),
  };
  return { page, waits };
}

describe("readyWaiter", () => {
  test("gives up after 2 s on a route and selector that already missed, and still fails", async () => {
    const wait = readyWaiter();
    const { page, waits } = fakePage(() => false);
    const home = { route: "/", ready: "text=How big?" };
    await expect(wait(page, home)).rejects.toThrow(`Timeout ${READY_MS}ms`);
    await expect(wait(page, home)).rejects.toThrow(`Timeout ${MISSED_READY_MS}ms`);
    await expect(wait(page, { route: "/jobs", ready: "h1" })).rejects.toThrow(
      `Timeout ${READY_MS}ms`,
    );
    expect(waits).toEqual([READY_MS, MISSED_READY_MS, READY_MS]);
  });

  test("waits the full time while nothing has missed, and passes what it finds", async () => {
    const wait = readyWaiter();
    let shown = false;
    const { page, waits } = fakePage(() => shown);
    const home = { route: "/", ready: "h1" };
    shown = true;
    await wait(page, home);
    await wait(page, home);
    shown = false;
    await expect(wait(page, home)).rejects.toThrow();
    shown = true;
    await expect(wait(page, home)).resolves.toBeUndefined();
    expect(waits).toEqual([READY_MS, READY_MS, READY_MS, MISSED_READY_MS]);
  });
});
