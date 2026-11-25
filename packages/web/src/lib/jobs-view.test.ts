import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { JobView } from "@conveyor/shared";
import { get } from "svelte/store";
import { at, catalog, entry, request } from "../../test/helpers/belt-ends";
import { announcements } from "./announce";
import type { JobHistoryEntry } from "./api";
import { midnight } from "./belt-ends";
import { PAGE } from "./jobs-list";
import { createJobsView } from "./jobs-view";

type Route = unknown | Error;

const live = (jobId: string, state: JobView["state"] = "printing"): JobView => ({
  jobId,
  state,
  at: at(10),
  ...request,
  createdAt: at(10),
});

const counts = { done: 3, failed: 1, canceled: 0 };

let routes: Record<string, Route>;
let asked: string[];
let fetchSpy: ReturnType<typeof spyOn>;
let visibility: DocumentVisibilityState;

const asFetch = (fake: (input: string | URL | Request) => Promise<Response>) =>
  Object.assign(fake, { preconnect: fetch.preconnect });

const answer = (path: string): Response => {
  const key = Object.keys(routes)
    .filter((prefix) => path.startsWith(prefix))
    .sort((a, b) => b.length - a.length)[0];
  const route = key === undefined ? new Error("no route") : routes[key];
  if (route instanceof Error) return new Response("down", { status: 503 });
  return Response.json(route);
};

beforeEach(() => {
  asked = [];
  visibility = "visible";
  routes = {
    "/api/catalog/printers": catalog.printers,
    "/api/generators": catalog.generators,
    "/api/jobs/active": [live("p1")],
    "/api/jobs-history/counts": counts,
    "/api/jobs-history?": [entry("d1", "done", at(9)), entry("f1", "failed", at(8))],
  };
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
    asFetch(async (input) => {
      const path = String(input);
      asked.push(path);
      return answer(path);
    }),
  );
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      get visibilityState() {
        return visibility;
      },
    },
  });
});

afterEach(() => {
  fetchSpy.mockRestore();
  Reflect.deleteProperty(globalThis, "document");
});

const history = () => asked.filter((path) => path.startsWith("/api/jobs-history?"));

describe("createJobsView", () => {
  test("load fills the live jobs, the settled history and the counts", async () => {
    const view = createJobsView(() => null);
    await view.load();
    const now = get(view);
    expect(now.loaded).toBe(true);
    expect(now.down).toBe(false);
    expect(now.live.map((row) => row.id)).toEqual(["p1"]);
    expect(now.settled.map((row) => row.id)).toEqual(["d1", "f1"]);
    expect(now.counts).toEqual(counts);
    expect(now.catalog?.printers.map((p) => p.id)).toEqual(["voron", "prusa", "ender"]);
    expect(now.more).toBe(false);
    expect(now.since).toBeUndefined();
  });

  test("today limits the history and the counts to jobs since midnight", async () => {
    const view = createJobsView(() => "today");
    await view.load();
    const since = midnight(new Date());
    expect(get(view).since).toBe(since);
    expect(history()[0]).toContain(`since=${since}`);
    expect(asked).toContain(`/api/jobs-history/counts?since=${since}`);
  });

  test("a full first page offers older jobs", async () => {
    routes["/api/jobs-history?"] = Array.from({ length: PAGE }, (_, i) =>
      entry(`d${i}`, "done", at(9) - i),
    );
    const view = createJobsView(() => null);
    await view.load();
    expect(get(view).more).toBe(true);
  });

  test("a history that can't load marks the belt down and still shows the live jobs", async () => {
    routes["/api/jobs-history?"] = new Error("down");
    const view = createJobsView(() => null);
    await view.load();
    const now = get(view);
    expect(now.down).toBe(true);
    expect(now.loaded).toBe(true);
    expect(now.live.map((row) => row.id)).toEqual(["p1"]);
  });

  test("counts that can't load keep the last counts", async () => {
    const view = createJobsView(() => null);
    await view.load();
    routes["/api/jobs-history/counts"] = new Error("down");
    await view.refresh();
    expect(get(view).counts).toEqual(counts);
  });

  test("live jobs that can't load leave the live list empty, not the history", async () => {
    routes["/api/jobs/active"] = new Error("down");
    const view = createJobsView(() => null);
    await view.load();
    expect(get(view).live).toEqual([]);
    expect(get(view).settled).toHaveLength(2);
    expect(get(view).down).toBe(false);
  });

  test("choosing a filter reloads the history for that state", async () => {
    const view = createJobsView(() => null);
    await view.load();
    await view.choose("failed");
    expect(get(view).filter).toBe("failed");
    expect(history().at(-1)).toContain("state=failed");
  });

  test("older asks for the page before the last settled job and merges it", async () => {
    const view = createJobsView(() => null);
    await view.load();
    routes["/api/jobs-history?"] = [entry("c1", "canceled", at(7))];
    await view.older();
    expect(history().at(-1)).toContain(`before=${encodeURIComponent(`${at(8)}:f1`)}`);
    expect(get(view).settled.map((row) => row.id)).toEqual(["d1", "f1", "c1"]);
    expect(get(view).more).toBe(false);
  });

  test("older that can't load says so and keeps the list", async () => {
    const view = createJobsView(() => null);
    await view.load();
    routes["/api/jobs-history?"] = new Error("down");
    await view.older();
    await Bun.sleep(120);
    expect(get(announcements.assertive)).toBe("Couldn't load older jobs. Try again.");
    expect(get(view).settled.map((row) => row.id)).toEqual(["d1", "f1"]);
  });

  test("a poll in a hidden tab asks nothing", async () => {
    const view = createJobsView(() => null);
    await view.load();
    asked = [];
    visibility = "hidden";
    await view.poll();
    expect(asked).toEqual([]);
  });

  test("a poll refreshes the history only when a live job has left the belt", async () => {
    const view = createJobsView(() => null);
    await view.load();
    asked = [];
    await view.poll();
    expect(history()).toEqual([]);
    routes["/api/jobs/active"] = [];
    const done: JobHistoryEntry = entry("p1", "done", at(11));
    routes["/api/jobs-history?"] = [done, entry("d1", "done", at(9))];
    await view.poll();
    expect(get(view).live).toEqual([]);
    expect(history()).toHaveLength(1);
    expect(get(view).settled.map((row) => row.id)).toEqual(["p1", "d1", "f1"]);
  });

  test("a load overtaken by a newer one is dropped", async () => {
    let release = () => {};
    const held = new Promise<void>((done) => {
      release = done;
    });
    let calls = 0;
    fetchSpy.mockImplementation(
      asFetch(async (input) => {
        const path = String(input);
        if (path !== "/api/jobs/active") return answer(path);
        calls += 1;
        if (calls === 1) {
          await held;
          return Response.json([live("p1")]);
        }
        return Response.json([live("p2")]);
      }),
    );
    const view = createJobsView(() => null);
    const first = view.load();
    await Bun.sleep(10);
    await view.load();
    release();
    await first;
    expect(calls).toBe(2);
    expect(get(view).live.map((row) => row.id)).toEqual(["p2"]);
  });

  test("markDown marks the belt down", () => {
    const view = createJobsView(() => null);
    view.markDown();
    expect(get(view).down).toBe(true);
  });
});
