import { expect, test } from "bun:test";
import { withPage } from "./fixtures.ts";
import { assertStyles, stylesProblem } from "./styles.ts";

const applied = { sheets: 1, unloaded: [], token: "#f4efe4", background: "rgb(244, 239, 228)" };

test("styles count as applied only when every sheet loaded and the body takes --bg", () => {
  expect(stylesProblem(applied)).toBeNull();
  expect(stylesProblem({ ...applied, unloaded: ["http://x/app.css"] })).toBe(
    "styles not applied: http://x/app.css didn't load",
  );
  expect(stylesProblem({ ...applied, sheets: 0 })).toBe("styles not applied: the page has no stylesheet");
  expect(stylesProblem({ ...applied, token: "" })).toBe("styles not applied: --bg isn't set on the root");
  expect(stylesProblem({ ...applied, background: "rgba(0, 0, 0, 0)" })).toBe(
    "styles not applied: the body has no background",
  );
});

const PAGE = '<link rel="stylesheet" href="http://visual.test/app.css"><h1>Jobs</h1>';
const CSS = ":root { --bg: #f4efe4; } body { background: var(--bg); }";

test("a page whose stylesheet is served passes, and one whose stylesheet is blocked fails", async () => {
  await withPage(async (page) => {
    await page.route("**/app.css", (route) => route.fulfill({ contentType: "text/css", body: CSS }));
    await page.setContent(PAGE);
    await assertStyles(page, 500);
  });
  await withPage(async (page) => {
    await page.route("**/app.css", (route) => route.abort());
    await page.setContent(PAGE);
    await expect(assertStyles(page, 500)).rejects.toThrow(
      "styles not applied: --bg isn't set on the root",
    );
  });
});
