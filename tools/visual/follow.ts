import type { Page } from "playwright";

interface Link {
  href: string;
  click(): void;
  remove(): void;
}
declare const document: { createElement(tag: "a"): Link; body: { append(link: Link): void } };
declare const window: { conveyorFollow?: string };

export async function follow(page: Page, href: string): Promise<void> {
  const token = `${Date.now()}-${Math.random()}`;
  await page.evaluate(
    ({ target, mark }) => {
      window.conveyorFollow = mark;
      const link = document.createElement("a");
      link.href = target;
      document.body.append(link);
      link.click();
      link.remove();
    },
    { target: href, mark: token },
  );
  await page.waitForURL((url) => `${url.pathname}${url.search}` === href);
  const kept = await page.evaluate(() => window.conveyorFollow);
  if (kept !== token)
    throw new Error(`follow ${href}: the page reloaded instead of navigating in place`);
}

export async function travel(page: Page, way: "back" | "forward", lands?: string): Promise<void> {
  await (way === "back" ? page.goBack() : page.goForward());
  if (lands) await page.waitForURL((url) => `${url.pathname}${url.search}` === lands);
}
