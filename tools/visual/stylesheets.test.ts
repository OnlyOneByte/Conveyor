import { expect, test } from "bun:test";
import { isStylesheet, type StylesheetRoute, serveStylesheet } from "./stylesheets.ts";

function fakeRoute(failures: number) {
  const fulfilled: string[] = [];
  const aborted: (string | undefined)[] = [];
  const seen = { fetches: 0, fulfilled, aborted };
  const route: StylesheetRoute<string> = {
    fetch: async () => {
      seen.fetches += 1;
      if (seen.fetches <= failures) throw new Error("net::ERR_NETWORK_CHANGED");
      return "body { color: red }";
    },
    fulfill: async ({ response }) => {
      seen.fulfilled.push(response);
    },
    abort: async (code) => {
      seen.aborted.push(code);
    },
  };
  return { route, seen };
}

test("a stylesheet is fetched once and served when the fetch works", async () => {
  const { route, seen } = fakeRoute(0);
  await serveStylesheet(route);
  expect(seen).toEqual({ fetches: 1, fulfilled: ["body { color: red }"], aborted: [] });
});

test("a stylesheet whose fetch fails once is fetched again and served", async () => {
  const { route, seen } = fakeRoute(1);
  await serveStylesheet(route);
  expect(seen).toEqual({ fetches: 2, fulfilled: ["body { color: red }"], aborted: [] });
});

test("a stylesheet that fails twice is aborted, so the shot reports it", async () => {
  const { route, seen } = fakeRoute(2);
  await serveStylesheet(route);
  expect(seen).toEqual({ fetches: 2, fulfilled: [], aborted: ["failed"] });
});

test("only .css paths are taken over", () => {
  expect(isStylesheet(new URL("http://127.0.0.1/_app/immutable/assets/Track.2XyWgnUt.css"))).toBe(
    true,
  );
  expect(isStylesheet(new URL("http://127.0.0.1/app.css?v=1"))).toBe(true);
  expect(isStylesheet(new URL("http://127.0.0.1/api/jobs/active"))).toBe(false);
  expect(isStylesheet(new URL("http://127.0.0.1/_app/immutable/entry/start.js"))).toBe(false);
});
