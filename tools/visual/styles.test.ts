import { expect, test } from "bun:test";
import type { Page } from "playwright";
import { browserPages } from "./fixtures.ts";
import { assertStyles, stylesProblem } from "./styles.ts";

const withPage = browserPages();

const applied = {
  sheets: 1,
  unloaded: [],
  empty: [],
  token: "#f4efe4",
  background: "rgb(244, 239, 228)",
  frame: "absolute",
};

test("styles count as applied only when every sheet has rules, the body takes --bg and the layout's rules apply", () => {
  expect(stylesProblem(applied)).toBeNull();
  expect(stylesProblem({ ...applied, unloaded: ["http://x/app.css"] })).toBe(
    "styles not applied: http://x/app.css didn't load",
  );
  expect(stylesProblem({ ...applied, sheets: 0 })).toBe(
    "styles not applied: the page has no stylesheet",
  );
  expect(stylesProblem({ ...applied, empty: ["http://x/make.css"] })).toBe(
    "styles not applied: http://x/make.css has no rules",
  );
  expect(stylesProblem({ ...applied, token: "" })).toBe(
    "styles not applied: --bg isn't set on the root",
  );
  expect(stylesProblem({ ...applied, background: "rgba(0, 0, 0, 0)" })).toBe(
    "styles not applied: the body has no background",
  );
  expect(stylesProblem({ ...applied, frame: "static" })).toBe(
    "styles not applied: the layout's rules didn't apply: a.skip is static, not absolute",
  );
  expect(stylesProblem({ ...applied, frame: "" })).toBe(
    "styles not applied: the layout's rules didn't apply: a.skip is missing, not absolute",
  );
});

const TOKENS = ":root { --bg: #f4efe4; } body { background: var(--bg); }";
const LAYOUT = `${TOKENS} .skip { position: absolute; top: -100px; }`;
const MAKE = ".layout { display: grid; }";
const PAGE =
  '<link rel="stylesheet" href="http://visual.test/app.css"><link rel="stylesheet" href="http://visual.test/make.css"><a class="skip" href="#main">Skip</a><h1>Make</h1>';

async function serve(page: Page, sheets: Record<string, string | null>): Promise<void> {
  await page.route("http://visual.test/**", (route) => {
    const name = new URL(route.request().url()).pathname.slice(1);
    if (name === "") return route.fulfill({ contentType: "text/html", body: PAGE });
    const body = sheets[name];
    return typeof body === "string"
      ? route.fulfill({ contentType: "text/css", body })
      : route.abort();
  });
  await page.goto("http://visual.test/");
}

test("served sheets pass; blocked, emptied and token-only sheets fail", async () => {
  await withPage(async (page) => {
    await serve(page, { "app.css": LAYOUT, "make.css": MAKE });
    await assertStyles(page, 500);
  });
  const cases: [Record<string, string | null>, string][] = [
    [{ "app.css": null, "make.css": MAKE }, "--bg isn't set on the root"],
    [{ "app.css": LAYOUT, "make.css": "" }, "http://visual.test/make.css has no rules"],
    [
      { "app.css": TOKENS, "make.css": MAKE },
      "the layout's rules didn't apply: a.skip is static, not absolute",
    ],
  ];
  for (const [sheets, why] of cases) {
    await withPage(async (page) => {
      await serve(page, sheets);
      await expect(assertStyles(page, 500)).rejects.toThrow(`styles not applied: ${why}`);
    });
  }
}, 30000);
