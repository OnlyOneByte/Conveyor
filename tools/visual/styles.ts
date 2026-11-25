import type { Page } from "playwright";

export const STYLES_MS = 5000;

const CLEAR = "rgba(0, 0, 0, 0)";

export interface StyleProbe {
  sheets: number;
  unloaded: string[];
  token: string;
  background: string;
}

declare const document: {
  styleSheets: { length: number };
  documentElement: unknown;
  body: unknown;
  querySelectorAll(selector: string): Iterable<{ sheet: unknown; href: string }>;
};
declare function getComputedStyle(element: unknown): {
  backgroundColor: string;
  getPropertyValue(name: string): string;
};

export function stylesProblem(probe: StyleProbe): string | null {
  const why =
    probe.unloaded.length > 0
      ? `${probe.unloaded.join(", ")} didn't load`
      : probe.sheets === 0
        ? "the page has no stylesheet"
        : probe.token === ""
          ? "--bg isn't set on the root"
          : probe.background === CLEAR
            ? "the body has no background"
            : null;
  return why && `styles not applied: ${why}`;
}

const probe = (): StyleProbe => ({
  sheets: document.styleSheets.length,
  unloaded: [...document.querySelectorAll('link[rel="stylesheet"]')]
    .filter((link) => !link.sheet)
    .map((link) => link.href),
  token: getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
  background: getComputedStyle(document.body).backgroundColor,
});

export async function assertStyles(page: Page, ms = STYLES_MS): Promise<void> {
  let problem = stylesProblem(await page.evaluate(probe));
  for (const until = Date.now() + ms; problem && Date.now() < until; ) {
    await Bun.sleep(100);
    problem = stylesProblem(await page.evaluate(probe));
  }
  if (problem) throw new Error(problem);
}
