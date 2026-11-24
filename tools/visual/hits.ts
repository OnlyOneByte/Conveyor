import type { Page } from "playwright";

export type Viewport = readonly [width: number, height: number];

export async function coveredTargets(page: Page, selector: string): Promise<string[]> {
  return page.evaluate((sel) => {
    const name = (el: Element) =>
      `${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).trim().split(/\s+/).join(".")}` : ""}`;
    return [...document.querySelectorAll(sel)].flatMap((el) => {
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return [];
      const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      if (top && (top === el || el.contains(top))) return [];
      return [
        `"${el.textContent?.trim()}" is covered by ${top ? name(top) : "nothing (off screen)"}`,
      ];
    });
  }, selector);
}

export async function assertHits(
  page: Page,
  selector: string,
  viewports: readonly Viewport[],
): Promise<void> {
  const original = page.viewportSize();
  const failures: string[] = [];
  for (const [width, height] of viewports) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => new Promise(requestAnimationFrame));
    for (const miss of await coveredTargets(page, selector))
      failures.push(`${width}x${height}: ${miss}`);
  }
  if (original) await page.setViewportSize(original);
  if (failures.length) throw new Error(`hits ${selector}: ${failures.join("; ")}`);
}
