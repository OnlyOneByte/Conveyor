import { describe, expect, test } from "bun:test";
import { budgetErrors, loosenedErrors, parseBudget } from "./budget";
import {
  bundlesThree,
  closure,
  missingCode,
  parseChunkModules,
  parseManifest,
  routeNodes,
  serviceWorkerPaths,
} from "./measure";

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
    expect(() =>
      parseBudget(JSON.stringify({ ...good, precache: { raw: "1291227", gzip: 1 } })),
    ).toThrow("precache.raw");
    expect(() => parseBudget(JSON.stringify({ ...good, initialJsGzip: { "/": -1 } }))).toThrow(
      "isn't a valid budget",
    );
    expect(() => parseBudget(JSON.stringify({ initialJsGzip: {} }))).toThrow("precache");
    expect(() => parseBudget("not json")).toThrow();
  });

  test("a manifest entry that isn't a chunk is an error", () => {
    expect(parseManifest(JSON.stringify({ a: { file: "a.js", imports: ["b"] } }))).toEqual({
      a: { file: "a.js", imports: ["b"] },
    });
    expect(() => parseManifest(JSON.stringify({ a: { imports: ["b"] } }))).toThrow("isn't valid");
    expect(() => parseManifest("[]")).toThrow("isn't valid");
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

const noCode = () => "";

describe("finding three.js in a route's chunks", () => {
  test("goes by the module ids each chunk was built from, on POSIX and Windows paths", () => {
    const modules = parseChunkModules(
      JSON.stringify({
        "a.js": ["/repo/packages/web/src/lib/api.ts"],
        "b.js": ["/repo/node_modules/.bun/three@0.187.0/node_modules/three/build/three.core.js"],
        "c.js": ["C:\\repo\\node_modules\\three\\build\\three.module.js"],
        "d.js": ["/repo/node_modules/three-mesh-bvh/index.js"],
      }),
    );
    expect(bundlesThree(["a.js"], modules, noCode)).toBe(false);
    expect(bundlesThree(["a.js", "b.js"], modules, noCode)).toBe(true);
    expect(bundlesThree(["c.js"], modules, noCode)).toBe(true);
    expect(bundlesThree(["d.js", "missing.js"], modules, noCode)).toBe(false);
    expect(
      bundlesThree(["vendored.js"], modules, (file) =>
        file === "vendored.js" ? "window.__THREE__=1" : "",
      ),
    ).toBe(true);
    expect(() => parseChunkModules(JSON.stringify({ "a.js": "x" }))).toThrow("isn't valid");
  });
});

describe("failing closed", () => {
  const ok = { raw: 1, gzip: 1, three: false };
  const precache = { raw: 1, gzip: 1, missing: [] };
  const budget = { initialJsGzip: { "/": 115_000 }, precache: { raw: 1, gzip: 1 } };

  test("no routes found, a budgeted route the build lacks, or no budget for / is an error", () => {
    expect(budgetErrors({ initialJs: {}, precache }, budget)).toEqual([
      "found no page routes in the server manifest, so nothing was checked; has SvelteKit's format changed?",
      "scripts/checks/bundle/budget.json budgets /, but the build has no such route",
    ]);
    expect(
      budgetErrors(
        { initialJs: { "/": ok }, precache },
        { ...budget, initialJsGzip: { "/gone": 1 } },
      ),
    ).toEqual([
      "scripts/checks/bundle/budget.json has no initial JS budget for /",
      "scripts/checks/bundle/budget.json budgets /gone, but the build has no such route",
    ]);
  });

  test("a service worker with no precache paths is an error, and its paths are read in order", () => {
    expect(serviceWorkerPaths("t=[{path:`_app/immutable/a.js`},{path:`favicon.svg`}]")).toEqual([
      "_app/immutable/a.js",
      "favicon.svg",
    ]);
    expect(() => serviceWorkerPaths("self.addEventListener()")).toThrow("found no precache paths");
  });
});

describe("the budget against the base branch", () => {
  const base = {
    initialJsGzip: { "/": 115_000, "/jobs/[id]": 115_000 },
    precache: { raw: 1_000_000, gzip: 400_000 },
  };

  test("tightening or keeping limits passes, and growing the precache under 10% passes", () => {
    expect(
      loosenedErrors(
        { ...base, initialJsGzip: { "/": 100_000, "/jobs/[id]": 115_000, "/new": 90_000 } },
        base,
      ),
    ).toEqual([]);
    expect(loosenedErrors({ ...base, precache: { raw: 1_100_000, gzip: 400_000 } }, base)).toEqual(
      [],
    );
  });

  test("raising or dropping a route limit, or raising the precache past 10%, is an error", () => {
    expect(
      loosenedErrors(
        { initialJsGzip: { "/": 120_000 }, precache: { raw: 1_100_001, gzip: 400_000 } },
        base,
      ),
    ).toEqual([
      "scripts/checks/bundle/budget.json raises the / budget from 115.0 KB to 120.0 KB",
      "scripts/checks/bundle/budget.json drops the /jobs/[id] budget the base has (115.0 KB)",
      "scripts/checks/bundle/budget.json raises the precache raw from 1000.0 KB to 1100.0 KB, more than 10% in one change",
    ]);
  });
});
