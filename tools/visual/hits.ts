import type { Page } from "playwright";

export type Viewport = readonly [width: number, height: number];

interface Target {
  tagName: string;
  className: unknown;
  textContent: string | null;
  getBoundingClientRect(): { x: number; y: number; width: number; height: number };
  contains(other: Target): boolean;
}

declare const document: {
  title: string;
  querySelector(selector: string): Target | null;
  querySelectorAll(selector: string): Iterable<Target>;
  elementFromPoint(x: number, y: number): Target | null;
};
declare const requestAnimationFrame: (run: (time: number) => void) => number;

export async function coveredTargets(page: Page, selector: string): Promise<string[]> {
  return page.evaluate((sel) => {
    const name = (el: Target) =>
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

export async function tabTo(page: Page, selector: string, presses = 80): Promise<void> {
  const covered: string[] = [];
  for (let press = 0; press < presses; press++) {
    await page.keyboard.press("Tab");
    await page.evaluate(() => new Promise(requestAnimationFrame));
    covered.push(...(await coveredTargets(page, ":focus")));
    const there = await page.evaluate((sel) => document.querySelector(`${sel}:focus`), selector);
    if (there) {
      if (covered.length) throw new Error(`tabTo ${selector}: ${covered.join("; ")}`);
      return;
    }
  }
  throw new Error(`tabTo ${selector}: not reached in ${presses} presses of Tab`);
}

export async function titleMismatch(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const h1 = document.querySelector("h1")?.textContent?.trim();
    const want = `${h1} · Conveyor`;
    return h1 === undefined || document.title === want
      ? null
      : `title "${document.title}" is not "${want}"`;
  });
}
