import { expect, test } from "bun:test";
import { withPage } from "./fixtures.ts";
import { hoverProblem } from "./hover-lint.ts";

const styled = (css: string) =>
  withPage(async (page) => {
    await page.setContent(`<style>${css}</style><a class="x">x</a>`);
    return hoverProblem(page);
  });

test("a :hover rule outside (hover: hover) fails, naming its selector", async () => {
  expect(await styled(".x:hover { color: red; }")).toBe(
    ":hover outside @media (hover: hover): .x:hover",
  );
  expect(await styled("@media (min-width: 1px) { .x:hover { color: red; } }")).toBe(
    ":hover outside @media (hover: hover): .x:hover in @media (min-width: 1px)",
  );
});

test("a wrapped rule passes, and so does the chip's reduced-motion override", async () => {
  expect(await styled("@media (hover: hover) { .x:hover { color: red; } }")).toBeNull();
  expect(
    await styled(
      "@media (prefers-reduced-motion: reduce) { .chip.svelte-a1:hover, .chip.svelte-a1:focus-visible { transform: none; } }",
    ),
  ).toBeNull();
  expect(
    await styled("@media (prefers-reduced-motion: reduce) { .x:hover { color: red; } }"),
  ).not.toBeNull();
});
