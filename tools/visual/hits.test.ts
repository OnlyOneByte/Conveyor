import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Browser, chromium } from "playwright";
import { assertHits } from "./hits.ts";

const PAGE = (ctaBottom: string) => `<style>
  nav { position: fixed; left: 0; right: 0; bottom: 0; height: 72px; display: flex; }
  nav a { flex: 1; }
  .cta { position: fixed; left: 0; right: 0; bottom: ${ctaBottom}; height: 64px; }
  @media (min-width: 760px) { nav { position: static; } .cta { display: none; } }
</style>
<nav><a href="/">Make</a><a href="/jobs">Jobs</a></nav>
<div class="cta"><button class="primary">Print</button></div>`;

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser.close();
});

test("names each target an overlay covers, per viewport", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.setContent(PAGE("0"));
  const run = assertHits(page, "nav a", [
    [390, 844],
    [1440, 900],
  ]);
  await expect(run).rejects.toThrow(
    '390x844: "Make" is covered by div.cta; 390x844: "Jobs" is covered by div.cta',
  );
  expect(page.viewportSize()).toEqual({ width: 390, height: 844 });
  await page.close();
});

test("passes when every target is on top", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.setContent(PAGE("72px"));
  await assertHits(page, "nav a, .cta button", [
    [390, 844],
    [390, 667],
    [1440, 900],
  ]);
  await page.close();
});
