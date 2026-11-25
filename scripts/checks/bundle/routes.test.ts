import { describe, expect, test } from "bun:test";
import { budgetErrors } from "./budget";
import { buildsCode } from "./measure";

const ok = { raw: 300_000, gzip: 100_000, three: false, zod: false, evals: false };
const editor = { editor: ["_app/immutable/chunks/e.js"], editorKept: [] };

describe("every route's first load", () => {
  const precache = { raw: 400_000, gzip: 100_000, missing: [], ...editor };
  const routes = { "/": 115_000, "/settings": 87_000 };
  const check = (settings: object) =>
    budgetErrors(
      { initialJs: { "/": ok, "/settings": { ...ok, gzip: 80_000, ...settings } }, precache },
      { initialJsGzip: routes, precache: { raw: 400_000, gzip: 100_000 } },
    );

  test("passes a budgeted route within its budget", () => {
    expect(check({})).toEqual([]);
  });

  test("fails a route over its own budget, as a static editor import on Settings would", () => {
    expect(check({ gzip: 94_100 })).toEqual([
      "/settings: initial JS is 94.1 KB gzip, over the 87.0 KB budget",
    ]);
  });

  test("fails Zod or new Function in one route's first load, not only the shared bundle", () => {
    expect(check({ zod: true, evals: true })).toEqual([
      "/settings: Zod is in the initial JS; import the Zod-free shared modules instead",
      "/settings: the initial JS builds code at runtime (Function, eval or a function's constructor), which the strict CSP refuses",
    ]);
  });

  test("fails a route the budget doesn't name, so a new route can't go unbudgeted", () => {
    const errors = budgetErrors(
      { initialJs: { "/": ok, "/new": { ...ok, gzip: 70_000 } }, precache },
      { initialJsGzip: { "/": 115_000 }, precache: { raw: 400_000, gzip: 100_000 } },
    );
    expect(errors).toEqual([
      "/new: no initial JS budget; add it to scripts/checks/bundle/budget.json (about 10% over its 70.0 KB gzip today)",
    ]);
  });
});

describe("finding code built at runtime", () => {
  test("matches Function and eval however a minifier leaves them", () => {
    for (const code of [
      'new Function("return 1")',
      "try{return Function(``),!0}",
      "globalThis.Function(`return 1`)()",
      "const q=Function;q(`return 1`)()",
      "(()=>{}).constructor(`return 1`)()",
      "eval(`1 + 1`)",
      "(0,eval)(`1 + 1`)",
    ])
      expect(buildsCode(code)).toBe(true);
  });

  test("leaves ordinary uses of the names alone", () => {
    for (const code of [
      "isFunction(x)",
      "r=n.map(t=>t instanceof Function?t(e):t)",
      "typeof e==`function`&&Function.prototype.toString.call(e)",
      "clone(){return new this.constructor(this.x,this.y)}",
      "page.evaluate(f)",
      "client.eval(script)",
    ])
      expect(buildsCode(code)).toBe(false);
  });
});
