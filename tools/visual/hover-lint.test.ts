import { expect, test } from "bun:test";
import { browserPages } from "./fixtures.ts";
import { hoverProblem } from "./hover-lint.ts";

const withPage = browserPages();

const ORIGIN = "http://lint.test";

const styled = (css: string, imported = "") =>
  withPage(async (page) => {
    await page.route(`${ORIGIN}/**`, (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/a.css") return route.fulfill({ contentType: "text/css", body: imported });
      return route.fulfill({
        contentType: "text/html",
        body: `<style>${css}</style><a class="x">x</a>`,
      });
    });
    await page.goto(`${ORIGIN}/`);
    return hoverProblem(page);
  });

const LOOSE = ":hover outside @media (hover: hover)";

test("a :hover rule outside (hover: hover) fails, naming its selector", async () => {
  expect(await styled(".x:hover { color: red; }")).toBe(`${LOOSE}: .x:hover`);
  expect(await styled("@media (min-width: 1px) { .x:hover { color: red; } }")).toBe(
    `${LOOSE}: .x:hover in @media (min-width: 1px)`,
  );
});

test("a media list that can match a device without hover counts as unwrapped", async () => {
  expect(await styled("@media not (hover: hover) { .x:hover { color: red; } }")).toContain(LOOSE);
  expect(
    await styled("@media (hover: none), (hover: hover) { .x:hover { color: red; } }"),
  ).toContain(LOOSE);
  for (const media of ["(hover: hover) or (pointer: coarse)", "(hover: hover) or (hover: none)"])
    expect(await styled(`@media ${media} { .x:hover { color: red; } }`)).toContain(LOOSE);
});

test("imported sheets are walked, under the import's own media", async () => {
  const rule = ".y:hover { color: red; }";
  expect(await styled('@import url("/a.css");', rule)).toBe(`${LOOSE}: .y:hover`);
  expect(await styled('@import url("/a.css") (hover: hover);', rule)).toBeNull();
});

test("a wrapped rule passes, and so does the chip's reduced-motion override", async () => {
  expect(await styled("@media (hover: hover) { .x:hover { color: red; } }")).toBeNull();
  expect(
    await styled("@media (min-width: 1px) { @media (hover: hover) { .x:hover { color: red; } } }"),
  ).toBeNull();
  const chip =
    "@media (prefers-reduced-motion: reduce) { .chip.svelte-a1:hover, .chip.svelte-a1:focus-visible { transform: none; } }";
  expect(await styled(chip)).toBeNull();
  expect(
    await styled("@media (prefers-reduced-motion: reduce) { .x:hover { color: red; } }"),
  ).not.toBeNull();
});
