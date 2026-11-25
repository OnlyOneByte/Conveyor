import type { Page } from "playwright";

export interface LooseHover {
  selector: string;
  media: string;
}

interface Rule {
  selectorText?: string;
  cssRules?: Iterable<Rule>;
  media?: { mediaText: string };
  styleSheet?: Sheet | null;
}

interface Sheet {
  href: string | null;
  cssRules: Iterable<Rule>;
}

declare const document: { styleSheets: Iterable<Sheet> };

const REDUCED = "prefers-reduced-motion: reduce";

export const allowedHover = ({ selector, media }: LooseHover) =>
  media.includes(REDUCED) && /^\.chip(\.svelte-[\w-]+)?:hover,/.test(selector);

export function looseHovers(page: Page): Promise<LooseHover[]> {
  return page.evaluate(() => {
    const only = (media: string) =>
      media
        .split(",")
        .map((query) => query.trim().toLowerCase())
        .every((query) => /\(\s*hover\s*:\s*hover\s*\)/.test(query) && !/(^|\s)not\b/.test(query));
    const out: { selector: string; media: string }[] = [];
    const walk = (rules: Iterable<Rule>, safe: boolean, media: string) => {
      for (const rule of rules) {
        if (rule.styleSheet !== undefined) {
          const text = rule.media?.mediaText ?? "";
          sheet(rule.styleSheet, safe || (text !== "" && only(text)), text || media);
          continue;
        }
        if (rule.media && rule.cssRules) {
          const text = rule.media.mediaText;
          walk(rule.cssRules, safe || only(text), text);
          continue;
        }
        if (!safe && rule.selectorText?.includes(":hover"))
          out.push({ selector: rule.selectorText, media });
        if (rule.cssRules) walk(rule.cssRules, safe, media);
      }
    };
    const sheet = (from: Sheet | null, safe: boolean, media: string) => {
      try {
        if (from) walk(from.cssRules, safe, media);
      } catch {
        out.push({ selector: `unreadable stylesheet ${from?.href}`, media });
      }
    };
    for (const each of document.styleSheets) sheet(each, false, "");
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
