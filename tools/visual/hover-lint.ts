import type { Page } from "playwright";

export interface LooseHover {
  selector: string;
  media: string;
}

const REDUCED = "prefers-reduced-motion: reduce";

export const allowedHover = ({ selector, media }: LooseHover) =>
  media.includes(REDUCED) && /^\.chip(\.svelte-[\w-]+)?:hover,/.test(selector);

export function looseHovers(page: Page): Promise<LooseHover[]> {
  return page.evaluate(() => {
    const out: { selector: string; media: string }[] = [];
    const walk = (rules: CSSRuleList, hover: boolean, media: string) => {
      for (const rule of rules) {
        if (rule instanceof CSSMediaRule) {
          const text = rule.conditionText;
          walk(rule.cssRules, hover || text.includes("hover: hover"), text);
          continue;
        }
        if (rule instanceof CSSStyleRule && !hover && rule.selectorText.includes(":hover"))
          out.push({ selector: rule.selectorText, media });
        if ("cssRules" in rule && rule.cssRules instanceof CSSRuleList)
          walk(rule.cssRules, hover, media);
      }
    };
    for (const sheet of document.styleSheets) {
      try {
        walk(sheet.cssRules, false, "");
      } catch {
        out.push({ selector: `unreadable stylesheet ${sheet.href}`, media: "" });
      }
    }
    return out;
  });
}

export async function hoverProblem(page: Page): Promise<string | null> {
  const loose = (await looseHovers(page)).filter((rule) => !allowedHover(rule));
  if (loose.length === 0) return null;
  const listed = loose.map((rule) =>
    rule.media ? `${rule.selector} in @media ${rule.media}` : rule.selector,
  );
  return `:hover outside @media (hover: hover): ${listed.join("; ")}`;
}
