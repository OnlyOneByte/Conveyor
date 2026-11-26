import { expect, test } from "bun:test";
import type { Page } from "playwright";
import { browserPages } from "./fixtures.ts";
import { assertStyles, describeStyles, failureMessage, stylesProblem } from "./styles.ts";

const withPage = browserPages();

declare const location: { reload(): void };

const applied = {
  sheets: 1,
  unloaded: [],
  failed: [],
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
  expect(stylesProblem({ ...applied, failed: ["http://x/app.css"] })).toBe(
    "styles not applied: http://x/app.css failed to load: its rules can't be read",
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
    [
      { "app.css": null, "make.css": MAKE },
      "http://visual.test/app.css failed to load: its rules can't be read",
    ],
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

const report = {
  url: "http://x/jobs",
  theme: "dark",
  bg: "",
  replaced: false,
  sheets: [
    { href: "http://x/app.css", loaded: true, rules: 120 },
    { href: "http://x/make.css", loaded: false, rules: 0 },
    { href: "http://x/route.css", loaded: true, rules: "unreadable (SecurityError)" },
    { href: "an inline <style>", loaded: true, rules: 2 },
  ],
};

test("a failure names each sheet, the root's data-theme and --bg, and how the page was set", () => {
  expect(describeStyles(report)).toBe(
    "Stylesheets: http://x/app.css (loaded, 120 rules); http://x/make.css (not loaded); " +
      "http://x/route.css (loaded, unreadable (SecurityError)); " +
      "an inline <style> (loaded, 2 rules). " +
      "Root data-theme: dark. Root --bg: empty. URL: http://x/jobs.",
  );
  expect(describeStyles({ ...report, sheets: [], theme: null, bg: "#f4efe4" })).toBe(
    "Stylesheets: none. Root data-theme: not set. Root --bg: #f4efe4. URL: http://x/jobs.",
  );
  expect(describeStyles({ ...report, url: "about:blank" })).toEndWith(
    "URL: about:blank. The page is about:blank, as page.setContent leaves a fresh page.",
  );
  expect(describeStyles({ ...report, replaced: true })).toEndWith(
    "The document was replaced in place after it was first checked " +
      "(document.open, as page.setContent does).",
  );
});

test("a forced failure carries the diagnostics, and a setContent rewrite is named", async () => {
  await withPage(async (page) => {
    await serve(page, { "app.css": null, "make.css": MAKE });
    const failure = assertStyles(page, 200);
    await expect(failure).rejects.toThrow(
      "styles not applied: http://visual.test/app.css failed to load: its rules can't be read. " +
        "Stylesheets: http://visual.test/app.css (loaded, unreadable (SecurityError)); " +
        "http://visual.test/make.css (loaded, 1 rule). " +
        "Root data-theme: not set. Root --bg: empty. URL: http://visual.test/.",
    );
  });
  await withPage(async (page) => {
    await serve(page, { "app.css": LAYOUT, "make.css": MAKE });
    await assertStyles(page, 200);
    await page.setContent('<html data-theme="dark"><a class="skip" href="#">Skip</a></html>');
    await expect(assertStyles(page, 200)).rejects.toThrow(
      "styles not applied: the page has no stylesheet. Stylesheets: none. " +
        "Root data-theme: dark. Root --bg: empty. URL: http://visual.test/. " +
        "The document was replaced in place after it was first checked",
    );
  });
  await withPage(async (page) => {
    await page.setContent("<p>bare</p>");
    await expect(assertStyles(page, 200)).rejects.toThrow(
      "The page is about:blank, as page.setContent leaves a fresh page.",
    );
  });
}, 30000);

test("the reason survives when the report can't be gathered", async () => {
  const reason = "styles not applied: --bg isn't set on the root";
  const lost = () =>
    Promise.reject(new Error("page.evaluate: Execution context was destroyed\n    at probe"));
  expect(await failureMessage(reason, lost)).toBe(
    `${reason}. report unavailable: page.evaluate: Execution context was destroyed`,
  );
  expect(await failureMessage(reason, () => Promise.reject("gone"))).toBe(
    `${reason}. report unavailable: gone`,
  );
  await withPage(async (page) => {
    await serve(page, { "app.css": LAYOUT, "make.css": MAKE });
    const gather = () => page.evaluate(() => new Promise<never>(() => location.reload()));
    expect(await failureMessage(reason, gather)).toStartWith(`${reason}. report unavailable: `);
  });
}, 30000);

test("an unreadable cross-origin sheet doesn't fail a page whose own sheets apply", async () => {
  await withPage(async (page) => {
    await page.route("http://elsewhere.test/**", (route) =>
      route.fulfill({ contentType: "text/css", body: "p { color: rgb(1, 2, 3); }" }),
    );
    await page.route("http://visual.test/**", (route) => {
      const name = new URL(route.request().url()).pathname.slice(1);
      if (name === "")
        return route.fulfill({
          contentType: "text/html",
          body: `${PAGE}<link rel="stylesheet" href="http://elsewhere.test/fonts.css">`,
        });
      return route.fulfill({ contentType: "text/css", body: name === "app.css" ? LAYOUT : MAKE });
    });
    await page.goto("http://visual.test/");
    await assertStyles(page, 200);
  });
}, 30000);
