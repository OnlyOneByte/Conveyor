import type { Page } from "playwright";

export const STYLES_MS = 5000;

const CLEAR = "rgba(0, 0, 0, 0)";

export const FRAME = { selector: "a.skip", position: "absolute" };

export interface StyleProbe {
  sheets: number;
  unloaded: string[];
  failed: string[];
  empty: string[];
  token: string;
  background: string;
  frame: string;
}

export interface SheetState {
  href: string;
  loaded: boolean;
  rules: number | string;
}

export interface StyleReport {
  url: string;
  theme: string | null;
  bg: string;
  replaced: boolean;
  sheets: SheetState[];
}

interface Sheet {
  href: string | null;
  cssRules: { length: number };
}

declare const document: {
  styleSheets: Iterable<Sheet>;
  documentElement: { getAttribute(name: string): string | null };
  body: unknown;
  location: { href: string };
  querySelector(selector: string): unknown;
  querySelectorAll(selector: string): Iterable<{ sheet: Sheet | null; href?: string }>;
};
declare const window: { stylesRoot?: unknown; stylesReplaced?: boolean };
declare function getComputedStyle(element: unknown): {
  backgroundColor: string;
  position: string;
  getPropertyValue(name: string): string;
};

const layoutMissed = (frame: string) =>
  `the layout's rules didn't apply: ${FRAME.selector} is ${frame || "missing"}, ` +
  `not ${FRAME.position}`;

export function stylesProblem(probe: StyleProbe): string | null {
  const why =
    probe.unloaded.length > 0
      ? `${probe.unloaded.join(", ")} didn't load`
      : probe.failed.length > 0
        ? `${probe.failed.join(", ")} failed to load: its rules can't be read`
        : probe.sheets === 0
          ? "the page has no stylesheet"
          : probe.empty.length > 0
            ? `${probe.empty.join(", ")} has no rules`
            : probe.token === ""
              ? "--bg isn't set on the root"
              : probe.background === CLEAR
                ? "the body has no background"
                : probe.frame !== FRAME.position
                  ? layoutMissed(probe.frame)
                  : null;
  return why && `styles not applied: ${why}`;
}

const probe = (frame: typeof FRAME): StyleProbe => {
  const root = document.documentElement;
  window.stylesReplaced ||= window.stylesRoot !== undefined && window.stylesRoot !== root;
  window.stylesRoot = root;
  const sheets = [...document.styleSheets];
  const readable = (sheet: Sheet) => {
    try {
      return sheet.cssRules.length >= 0;
    } catch {
      return false;
    }
  };
  const isEmpty = (sheet: Sheet) => readable(sheet) && sheet.cssRules.length === 0;
  const links = [...document.querySelectorAll('link[rel="stylesheet"]')];
  const marker = document.querySelector(frame.selector);
  return {
    sheets: sheets.length,
    unloaded: links.filter((link) => !link.sheet).map((link) => link.href ?? ""),
    failed: links
      .filter((link) => link.sheet && !readable(link.sheet))
      .map((link) => link.href ?? ""),
    empty: sheets.filter(isEmpty).map((sheet) => sheet.href ?? "an inline <style>"),
    token: getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
    background: getComputedStyle(document.body).backgroundColor,
    frame: marker ? getComputedStyle(marker).position : "",
  };
};

const report = (): StyleReport => {
  const count = (sheet: Sheet) => {
    try {
      return sheet.cssRules.length;
    } catch (err) {
      return `unreadable (${err instanceof Error ? err.name : String(err)})`;
    }
  };
  const nodes = [...document.querySelectorAll('link[rel="stylesheet"], style')];
  return {
    url: document.location.href,
    theme: document.documentElement.getAttribute("data-theme"),
    bg: getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
    replaced: window.stylesReplaced === true,
    sheets: nodes.map((node) => ({
      href: node.href || "an inline <style>",
      loaded: node.sheet !== null,
      rules: node.sheet ? count(node.sheet) : 0,
    })),
  };
};

const ruleCount = (rules: number | string) =>
  typeof rules === "number" ? `${rules} rule${rules === 1 ? "" : "s"}` : rules;

const sheetLine = ({ href, loaded, rules }: SheetState) =>
  loaded ? `${href} (loaded, ${ruleCount(rules)})` : `${href} (not loaded)`;

export function describeStyles(state: StyleReport): string {
  const sheets = state.sheets.length ? state.sheets.map(sheetLine).join("; ") : "none";
  const how =
    state.url === "about:blank"
      ? " The page is about:blank, as page.setContent leaves a fresh page."
      : state.replaced
        ? " The document was replaced in place after it was first checked " +
          "(document.open, as page.setContent does)."
        : "";
  return (
    `Stylesheets: ${sheets}. Root data-theme: ${state.theme ?? "not set"}. ` +
    `Root --bg: ${state.bg || "empty"}. URL: ${state.url}.${how}`
  );
}

export async function assertStyles(page: Page, ms = STYLES_MS): Promise<void> {
  const read = async () => stylesProblem(await page.evaluate(probe, FRAME));
  let problem = await read();
  for (const until = Date.now() + ms; problem && Date.now() < until; ) {
    await Bun.sleep(100);
    problem = await read();
  }
  if (problem) throw new Error(`${problem}. ${describeStyles(await page.evaluate(report))}`);
}
