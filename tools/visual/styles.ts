import type { Page } from "playwright";

export const STYLES_MS = 5000;

const CLEAR = "rgba(0, 0, 0, 0)";

export const FRAME = { selector: "a.skip", position: "absolute" };

export interface StyleProbe {
  sheets: number;
  unloaded: string[];
  empty: string[];
  token: string;
  background: string;
  frame: string;
}

declare const document: {
  styleSheets: Iterable<{ href: string | null; cssRules: { length: number } }>;
  documentElement: unknown;
  body: unknown;
  querySelector(selector: string): unknown;
  querySelectorAll(selector: string): Iterable<{ sheet: unknown; href: string }>;
};
declare function getComputedStyle(element: unknown): {
  backgroundColor: string;
  position: string;
  getPropertyValue(name: string): string;
};

export function stylesProblem(probe: StyleProbe): string | null {
  const why =
    probe.unloaded.length > 0
      ? `${probe.unloaded.join(", ")} didn't load`
      : probe.sheets === 0
        ? "the page has no stylesheet"
        : probe.empty.length > 0
          ? `${probe.empty.join(", ")} has no rules`
          : probe.token === ""
            ? "--bg isn't set on the root"
            : probe.background === CLEAR
              ? "the body has no background"
              : probe.frame !== FRAME.position
                ? `the layout's rules didn't apply: ${FRAME.selector} is ${probe.frame || "missing"}, not ${FRAME.position}`
                : null;
  return why && `styles not applied: ${why}`;
}

const probe = (frame: typeof FRAME): StyleProbe => {
  const sheets = [...document.styleSheets];
  const isEmpty = (sheet: (typeof sheets)[number]) => {
    try {
      return sheet.cssRules.length === 0;
    } catch {
      return false;
    }
  };
  const marker = document.querySelector(frame.selector);
  return {
    sheets: sheets.length,
    unloaded: [...document.querySelectorAll('link[rel="stylesheet"]')]
      .filter((link) => !link.sheet)
      .map((link) => link.href),
    empty: sheets.filter(isEmpty).map((sheet) => sheet.href ?? "an inline <style>"),
    token: getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
    background: getComputedStyle(document.body).backgroundColor,
    frame: marker ? getComputedStyle(marker).position : "",
  };
};

export async function assertStyles(page: Page, ms = STYLES_MS): Promise<void> {
  const read = async () => stylesProblem(await page.evaluate(probe, FRAME));
  let problem = await read();
  for (const until = Date.now() + ms; problem && Date.now() < until; ) {
    await Bun.sleep(100);
    problem = await read();
  }
  if (problem) throw new Error(problem);
}
