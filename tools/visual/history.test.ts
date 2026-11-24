import { describe, expect, test } from "bun:test";
import {
  fulfillPinned,
  fulfillPinnedEntry,
  HISTORY_EPOCH,
  isHistoryEntry,
  isHistoryList,
  pinHistory,
  pinHistoryEntry,
  pinHistoryRoute,
} from "./history.ts";

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

describe("the /api/jobs-history route", () => {
  test("matches the list with or without a query, and not a single job's detail or another path", () => {
    expect(isHistoryList(new URL("http://127.0.0.1/api/jobs-history"))).toBe(true);
    expect(isHistoryList(new URL("http://127.0.0.1/api/jobs-history?limit=200"))).toBe(true);
    expect(isHistoryList(new URL("http://127.0.0.1/api/jobs-history/4a136f3c"))).toBe(false);
    expect(isHistoryList(new URL("http://127.0.0.1/api/jobs/active"))).toBe(false);
    expect(isHistoryList(new URL("http://127.0.0.1/jobs-history"))).toBe(false);
  });

  const fakeRoute = (ok: boolean, body: unknown) => {
    const fulfilled: unknown[] = [];
    const response = { ok: () => ok, json: async () => body };
    const route = {
      fetch: async () => response,
      fulfill: async (options: unknown) => {
        fulfilled.push(options);
      },
    };
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

  test("settles quietly when the page closed and its response is gone", async () => {
    const { route, fulfilled } = fakeRoute(true, []);
    const gone = {
      ...route,
      fetch: async () => ({
        ok: () => true,
        json: async () => Promise.reject(new Error("Response has been disposed")),
      }),
    };
    await expect(fulfillPinned(gone)).resolves.toBeUndefined();
    expect(fulfilled).toEqual([]);
  });
});

describe("one job's detail, /api/jobs-history/<id>", () => {
  test("matches one job's path and nothing else", () => {
    expect(isHistoryEntry(new URL("http://127.0.0.1/api/jobs-history/seed-canceled"))).toBe(true);
    expect(isHistoryEntry(new URL("http://127.0.0.1/api/jobs-history"))).toBe(false);
    expect(isHistoryEntry(new URL("http://127.0.0.1/api/jobs-history/"))).toBe(false);
    expect(isHistoryEntry(new URL("http://127.0.0.1/api/jobs-history/a/artifact"))).toBe(false);
    expect(isHistoryEntry(new URL("http://127.0.0.1/api/jobs/seed-canceled"))).toBe(false);
  });

  test("pins the times and keeps the id and every other field", () => {
    expect(pinHistoryEntry(job("seed-canceled", 1795000001000))).toEqual({
      ...job("seed-canceled", HISTORY_EPOCH),
      updatedAt: HISTORY_EPOCH,
    });
  });

  test("gives two runs with different live times the same body", () => {
    expect(pinHistoryEntry(job("seed-canceled", 1))).toEqual(
      pinHistoryEntry(job("seed-canceled", 2)),
    );
  });

  test("leaves a body that is not one job as it is", () => {
    expect(pinHistoryEntry([job("a", 1)])).toEqual([job("a", 1)]);
    expect(pinHistoryEntry(null)).toBeNull();
  });

  test("the route pins a successful detail response", async () => {
    const fulfilled: unknown[] = [];
    const response = { ok: () => true, json: async () => job("seed-canceled", 7) };
    const route = {
      fetch: async () => response,
      fulfill: async (options: unknown) => {
        fulfilled.push(options);
      },
    };
    await fulfillPinnedEntry(route);
    expect(fulfilled).toEqual([{ response, json: pinHistoryEntry(job("seed-canceled", 7)) }]);
  });
});

describe("a time field the API did not return", () => {
  const withoutCreatedAt = () => {
    const { createdAt: _missing, ...rest } = job("seed-failed", 1795000001000);
    return rest;
  };

  test("stays missing on one job's detail, so the page still shows it broken", () => {
    expect(pinHistoryEntry(withoutCreatedAt())).toStrictEqual({
      ...withoutCreatedAt(),
      updatedAt: HISTORY_EPOCH,
    });
  });

  test("stays missing in the list too", () => {
    expect(pinHistory([withoutCreatedAt()])).toStrictEqual([
      {
        ...withoutCreatedAt(),
        id: "00000001-0000-4000-8000-000000000000",
        updatedAt: HISTORY_EPOCH + 60_000,
      },
    ]);
  });
});

describe("pinHistoryRoute", () => {
  test("registers the list pin and the detail pin on the context", async () => {
    const routes: [(url: URL) => boolean, unknown][] = [];
    const context = {
      route: async (match: (url: URL) => boolean, handler: unknown) => {
        routes.push([match, handler]);
      },
    };
    await pinHistoryRoute(context);
    expect(routes.map(([, handler]) => handler)).toEqual([fulfillPinned, fulfillPinnedEntry]);
    const [list, entry] = routes.map(([match]) => match);
    expect(list(new URL("http://127.0.0.1/api/jobs-history"))).toBe(true);
    expect(entry(new URL("http://127.0.0.1/api/jobs-history/seed-failed"))).toBe(true);
  });
});
