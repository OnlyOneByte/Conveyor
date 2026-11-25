import { expect, test } from "bun:test";
import { withPage } from "./fixtures.ts";
import { assertRing, ringBand } from "./ring.ts";

test("the band runs along each straight edge, two pixels deep, and skips the rounded corners", () => {
  const band = ringBand({ x: 10, y: 10, width: 100, height: 30 });
  expect(band.length).toBe(2 * (100 - 2 * 12) + 2 * (30 - 2 * 10));
  expect(band[0]).toEqual([
    [22, 9],
    [22, 8],
  ]);
  expect(ringBand({ x: 0, y: 0, width: 20, height: 40 }).length).toBe(2 * (40 - 2 * 13));
});

const button = (hover: string) =>
  `<style>body { margin: 0; padding: 40px; background: #fbf8f2; } button { width: 200px; height: 42px; border: 0; border-radius: 8px; background: #f0782a; } button:hover { ${hover} }</style><button>Print</button>`;

test("a 2 px ink ring on hover passes, and a hover that drops it fails", async () => {
  await withPage(async (page) => {
    await page.setContent(button("box-shadow: 0 0 0 2px #2a2118;"));
    await assertRing(page, "button");
  });
  await withPage(async (page) => {
    await page.setContent(button("box-shadow: none;"));
    await expect(assertRing(page, "button")).rejects.toThrow(
      "ring button: 0% of the pixels just outside it change by 3:1 on hover (lowest 1.00:1); 90% must",
    );
  });
});
