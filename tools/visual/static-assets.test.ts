import { expect, test } from "bun:test";
import { isHashedAsset } from "./css-net.ts";
import type { Scene } from "./scene.ts";
import { type AssetRoute, routeHashedAssets, serveAsset } from "./static-assets.ts";

const ASSET = "http://127.0.0.1/_app/immutable/chunks/Track.2XyWgnUt.js";

function fakeRoute(errors: string[]) {
  const fulfilled: string[] = [];
  const aborted: (string | undefined)[] = [];
  const failed: string[] = [];
  const seen = { fetches: 0, fulfilled, aborted, failed };
  const route: AssetRoute<string> = {
    request: () => ({ url: () => ASSET }),
    fetch: async () => {
      const error = errors[seen.fetches];
      seen.fetches += 1;
      if (error) throw new Error(error);
      return "export {}";
    },
    fulfill: async ({ response }) => {
      seen.fulfilled.push(response);
    },
    abort: async (code) => {
      seen.aborted.push(code);
    },
  };
  const report = (url: string, error: string) => {
    seen.failed.push(`${url} ${error}`);
  };
  return { route, report, seen };
}

test("an asset is fetched once and served when the fetch works", async () => {
  const { route, report, seen } = fakeRoute([]);
  await serveAsset(route, report);
  expect(seen).toEqual({ fetches: 1, fulfilled: ["export {}"], aborted: [], failed: [] });
});

test("an asset whose fetch fails once is fetched again and served", async () => {
  const { route, report, seen } = fakeRoute(["net::ERR_NETWORK_CHANGED"]);
  await serveAsset(route, report);
  expect(seen).toEqual({ fetches: 2, fulfilled: ["export {}"], aborted: [], failed: [] });
});

test("an asset that fails twice is aborted, and the second fetch's real error is reported", async () => {
  const { route, report, seen } = fakeRoute(["first", "connect ECONNREFUSED 127.0.0.1:4173"]);
  await serveAsset(route, report);
  expect(seen).toEqual({
    fetches: 2,
    fulfilled: [],
    aborted: ["failed"],
    failed: [`${ASSET} connect ECONNREFUSED 127.0.0.1:4173`],
  });
});

test("hashed JS, CSS and fonts are taken over; API calls, the document and other files are not", () => {
  const taken = (path: string) => isHashedAsset(new URL(`http://127.0.0.1${path}`));
  expect(taken("/_app/immutable/chunks/Track.2XyWgnUt.js")).toBe(true);
  expect(taken("/_app/immutable/entry/start.BqX1.js")).toBe(true);
  expect(taken("/_app/immutable/assets/Track.2XyWgnUt.css")).toBe(true);
  expect(taken("/_app/immutable/assets/inter-latin-400.Cw1.woff2")).toBe(true);
  expect(taken("/api/jobs/active")).toBe(false);
  expect(taken("/jobs/seed-failed")).toBe(false);
  expect(taken("/")).toBe(false);
  expect(taken("/_app/version.json")).toBe(false);
  expect(taken("/favicon.svg")).toBe(false);
});

const scene = (steps: Scene["steps"]): Scene => ({ name: "s", route: "/", ready: "h1", steps });

test("scenes that keep the service worker get no route; every other scene does", async () => {
  const routed: string[] = [];
  const context = {
    route: async () => {
      routed.push("route");
    },
  };
  const none = () => {};
  expect(await routeHashedAssets(context, scene([{ offline: "h1" }]), none)).toBe(false);
  expect(await routeHashedAssets(context, scene([{ offline: "h1", only: "editor" }]), none)).toBe(
    true,
  );
  expect(await routeHashedAssets(context, scene([]), none)).toBe(true);
  expect(routed).toEqual(["route", "route"]);
});
