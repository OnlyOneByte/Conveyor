import { describe, expect, test } from "bun:test";
import { budgetErrors, parseBudget } from "./budget";
import { closure, missingCode, parseManifest, routeNodes } from "./measure";

const budget = { initialJsGzip: { "/": 115_000 }, precache: { raw: 1_000_000, gzip: 400_000 } };
const ok = { raw: 300_000, gzip: 100_000, three: false };

describe("the bundle budget", () => {
  test("passes within budget and 10% precache growth", () => {
    expect(
      budgetErrors(
        { initialJs: { "/": ok }, precache: { raw: 1_100_000, gzip: 440_000, missing: [] } },
        budget,
      ),
    ).toEqual([]);
  });

  test("fails on initial JS over budget, three.js on first load, or precache growth past 10%", () => {
    const errors = budgetErrors(
      {
        initialJs: { "/": { raw: 1_100_000, gzip: 312_310, three: true } },
        precache: { raw: 1_100_001, gzip: 400_000, missing: ["_app/immutable/chunks/a.js"] },
      },
      budget,
    );
    expect(errors).toEqual([
      "/: three.js is in the initial JS; load it with import() when a canvas mounts",
      "/: initial JS is 312.3 KB gzip, over the 115.0 KB budget",
      "service-worker precache leaves out _app/immutable/chunks/a.js; the app needs every immutable .js and .css offline",
      "service-worker precache is 1100.0 KB raw, more than 10% over the committed 1000.0 KB; run `bun run check:bundle:update` if the growth is wanted",
    ]);
  });
});

describe("the initial JS of a route", () => {
  test("reads each route's layouts and leaf from the server manifest", () => {
    const manifest = `{ id: "/", pattern: /^\\/$/, page: { layouts: [0,], errors: [1,], leaf: 2 } }, { id: "/jobs/[id]", x: 1, page: { layouts: [0], errors: [1], leaf: 5 } }`;
    expect([...routeNodes(manifest)]).toEqual([
      ["/", [0, 2]],
      ["/jobs/[id]", [0, 5]],
    ]);
  });

  test("follows static imports only, so a dynamic import stays out", () => {
    const manifest = {
      entry: { file: "entry.js", isEntry: true, imports: ["_shared"] },
      _shared: { file: "shared.js" },
      _three: { file: "three.js" },
      node: { file: "node.js", imports: ["_shared"], dynamicImports: ["_three"] },
    };
    expect([...closure(manifest, ["entry", "node"])].sort()).toEqual([
      "entry.js",
      "node.js",
      "shared.js",
    ]);
  });
});

describe("reading the budget and the manifest", () => {
  test("a budget with a missing or non-numeric size is refused, so the gate can't pass by NaN", () => {
    const good = { initialJsGzip: { "/": 115000 }, precache: { raw: 1, gzip: 1 } };
    expect(parseBudget(JSON.stringify(good))).toEqual(good);
    expect(
      parseBudget(JSON.stringify({ ...good, precache: { raw: "1291227", gzip: 1 } })),
    ).toBeNull();
    expect(parseBudget(JSON.stringify({ ...good, initialJsGzip: { "/": -1 } }))).toBeNull();
    expect(parseBudget(JSON.stringify({ initialJsGzip: {} }))).toBeNull();
    expect(parseBudget("not json")).toBeNull();
  });

  test("a manifest entry that isn't a chunk is an error", () => {
    expect(parseManifest(JSON.stringify({ a: { file: "a.js", imports: ["b"] } }))).toEqual({
      a: { file: "a.js", imports: ["b"] },
    });
    expect(() => parseManifest(JSON.stringify({ a: { imports: ["b"] } }))).toThrow("isn't a chunk");
    expect(() => parseManifest("[]")).toThrow("isn't an object");
  });

  test("every route with a page is listed, and server-only routes are skipped", () => {
    const manifest = `routes: [{ id: "/api/x", pattern: /x/, page: null, endpoint: e }, { id: "/monitor", page: { layouts: [0], errors: [1], leaf: 6 } }]`;
    expect([...routeNodes(manifest)]).toEqual([["/monitor", [0, 6]]]);
  });

  test("an immutable .js or .css the precache drops is reported", () => {
    const immutable = ["_app/immutable/a.js", "_app/immutable/b.css", "_app/immutable/c.wasm"];
    expect(missingCode(immutable, ["_app/immutable/b.css"])).toEqual(["_app/immutable/a.js"]);
  });
});
