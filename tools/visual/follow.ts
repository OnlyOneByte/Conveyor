import type { Page } from "playwright";

interface Link {
  href: string;
  click(): void;
  remove(): void;
}
declare const document: { createElement(tag: "a"): Link; body: { append(link: Link): void } };

export async function follow(page: Page, href: string): Promise<void> {
  await page.evaluate((target) => {
    const link = document.createElement("a");
    link.href = target;
    document.body.append(link);
    link.click();
    link.remove();
  }, href);
  await page.waitForURL((url) => `${url.pathname}${url.search}` === href);
}
