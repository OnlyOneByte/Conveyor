import { describe, expect, test } from "bun:test";
import type { Route } from "playwright";
import { fulfillPinned, HISTORY_EPOCH, isHistoryList, pinHistory } from "./history.ts";

const job = (id: string, createdAt: number) => ({
  id,
  request: { generator: { id: "gridfinity" }, printerId: "elegoo-1", profileId: "p" },
  state: "failed",
  error: { stage: "slicing", reason: "x" },
  createdAt,
  updatedAt: createdAt + 5,
});

describe("pinHistory", () => {
  test("replaces ids and times by position, oldest first, and keeps every other field", () => {
    const pinned = pinHistory([job("b7f3c1d2", 1795000002000), job("4a136f3c", 1795000001000)]);
    expect(pinned).toEqual([
      {
        ...job("00000002-0000-4000-8000-000000000000", HISTORY_EPOCH + 120_000),
        updatedAt: HISTORY_EPOCH + 120_000,
      },
      {
        ...job("00000001-0000-4000-8000-000000000000", HISTORY_EPOCH + 60_000),
        updatedAt: HISTORY_EPOCH + 60_000,
      },
    ]);
  });

  test("gives two runs with different live ids and times the same body", () => {
    const first = pinHistory([job("aaaa", 1), job("bbbb", 2)]);
    const second = pinHistory([job("cccc", 3), job("dddd", 4)]);
    expect(second).toEqual(first);
  });

  test("leaves a body that is not a list of jobs as it is", () => {
    expect(pinHistory({ error: "boom" })).toEqual({ error: "boom" });
    expect(pinHistory([null, 3])).toEqual([null, 3]);
  });
});

describe("the /jobs-history route", () => {
  test("matches the list with or without a query, and not a single job's detail", () => {
    expect(isHistoryList(new URL("http://127.0.0.1/jobs-history"))).toBe(true);
    expect(isHistoryList(new URL("http://127.0.0.1/jobs-history?limit=200"))).toBe(true);
    expect(isHistoryList(new URL("http://127.0.0.1/jobs-history/4a136f3c"))).toBe(false);
  });

  const fakeRoute = (ok: boolean, body: unknown) => {
    const fulfilled: unknown[] = [];
    const response = { ok: () => ok, json: async () => body };
    const route = {
      fetch: async () => response,
      fulfill: async (options: unknown) => {
        fulfilled.push(options);
      },
    } as unknown as Route;
    return { route, response, fulfilled };
  };

  test("pins the body of a successful response", async () => {
    const { route, response, fulfilled } = fakeRoute(true, [job("live", 5)]);
    await fulfillPinned(route);
    expect(fulfilled).toEqual([{ response, json: pinHistory([job("live", 5)]) }]);
  });

  test("passes an error response through untouched", async () => {
    const { route, response, fulfilled } = fakeRoute(false, { error: "boom" });
    await fulfillPinned(route);
    expect(fulfilled).toEqual([{ response }]);
  });
});
