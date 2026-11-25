import type { Page } from "playwright";

export const TAP_PX = 44;

const REACH = 30;

const INTERACTIVE =
  "a[href], button, summary, select, textarea, input:not([type=hidden]), [role=button], [role=tab], [tabindex]:not([tabindex='-1'])";

interface Target {
  tagName: string;
  textContent: string | null;
  getAttribute(name: string): string | null;
  getBoundingClientRect(): { x: number; y: number; width: number; height: number };
  scrollIntoView(options: { block: string; inline: string }): void;
  closest(selector: string): Target | null;
  contains(other: Target): boolean;
}

declare const document: {
  querySelectorAll(selector: string): Iterable<Target>;
  elementFromPoint(x: number, y: number): Target | null;
};
declare function getComputedStyle(element: Target): { visibility: string };

export interface SmallTarget {
  name: string;
  width: number;
  height: number;
}

export const targetProblem = (within: string, small: readonly SmallTarget[]): string | null =>
  small.length === 0
    ? null
    : `targets in ${within} under ${TAP_PX}×${TAP_PX} px of hit area: ${small.map((s) => `${s.name} ${s.width}×${s.height}`).join("; ")}`;

export async function smallTargets(page: Page, within: string): Promise<SmallTarget[]> {
  return page.evaluate(
    ({ scope, selector, reach, tap }) => {
      const seen = new Set<Target>();
      const small: { name: string; width: number; height: number }[] = [];
      for (const area of [...document.querySelectorAll(scope)]) {
        for (const found of [...document.querySelectorAll(selector)]) {
          if (!area.contains(found)) continue;
          const el = found.tagName === "INPUT" ? (found.closest("label") ?? found) : found;
          if (seen.has(el)) continue;
          seen.add(el);
          const box = el.getBoundingClientRect();
          if (box.width === 0 || box.height === 0 || getComputedStyle(el).visibility === "hidden")
            continue;
          el.scrollIntoView({ block: "center", inline: "center" });
          const r = el.getBoundingClientRect();
          const [cx, cy] = [r.x + r.width / 2, r.y + r.height / 2];
          const hit = (x: number, y: number) => {
            const top = document.elementFromPoint(x, y);
            return top !== null && (top === el || el.contains(top));
          };
          const span = (dx: number, dy: number) => {
            let d = 0;
            while (d < reach && hit(cx + dx * (d + 1), cy + dy * (d + 1))) d++;
            return d;
          };
          if (!hit(cx, cy)) continue;
          const width = span(-1, 0) + span(1, 0) + 1;
          const height = span(0, -1) + span(0, 1) + 1;
          if (width >= tap - 1 && height >= tap - 1) continue;
          const name = (el.getAttribute("aria-label") ?? el.textContent ?? "")
            .trim()
            .replace(/\s+/g, " ")
            .slice(0, 40);
          small.push({ name: `${el.tagName.toLowerCase()} "${name}"`, width, height });
        }
      }
      return small;
    },
    { scope: within, selector: INTERACTIVE, reach: REACH, tap: TAP_PX },
  );
}

export async function assertTargets(page: Page, within: string): Promise<void> {
  const problem = targetProblem(within, await smallTargets(page, within));
  if (problem) throw new Error(problem);
}
