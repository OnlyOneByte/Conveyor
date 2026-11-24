import { describe, expect, test } from "bun:test";
import { budgetErrors } from "./budget";
import { closure, routeNodes } from "./measure";

const budget = { initialJsGzip: { "/": 115_000 }, precache: { raw: 1_000_000, gzip: 400_000 } };
const ok = { raw: 300_000, gzip: 100_000, three: false };

describe("the bundle budget", () => {
  test("passes within budget and 10% precache growth", () => {
    expect(
      budgetErrors({ initialJs: { "/": ok }, precache: { raw: 1_100_000, gzip: 440_000 } }, budget),
    ).toEqual([]);
  });

  test("fails on initial JS over budget, three.js on first load, or precache growth past 10%", () => {
    const errors = budgetErrors(
      {
        initialJs: { "/": { raw: 1_100_000, gzip: 312_310, three: true } },
        precache: { raw: 1_100_001, gzip: 400_000 },
      },
      budget,
    );
    expect(errors).toEqual([
      "/: three.js is in the initial JS; load it with import() when a canvas mounts",
      "/: initial JS is 312.3 KB gzip, over the 115.0 KB budget",
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
