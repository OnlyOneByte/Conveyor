import type { Page } from "playwright";
import type { Step } from "./scenes.ts";

export const MAX_SHIFT_PX = 4;

type Hold = Extract<Step, { holds: string }>;

declare const document: {
  querySelector(selector: string): { getBoundingClientRect(): { top: number } } | null;
};
declare const requestAnimationFrame: (run: (time: number) => void) => number;
declare function scrollTo(x: number, y: number): void;

export interface Sample {
  present: boolean;
  top: number | null;
}

export function holdProblem(samples: Sample[], expectedTop: number | null): string | null {
  if (samples.length === 0) return "no samples were taken";
  const gone = samples.findIndex((s) => !s.present);
  if (gone >= 0) return `gone at sample ${gone} of ${samples.length}`;
  const tops = samples.flatMap((s) => (s.top === null ? [] : [s.top]));
  if (expectedTop === null || tops.length < samples.length) return "the anchor is missing";
  const shift = Math.max(...tops.map((top) => Math.abs(top - expectedTop)));
  return shift > MAX_SHIFT_PX ? `the anchor moved ${Math.round(shift)} px` : null;
}

export async function assertHolds(page: Page, step: Hold): Promise<void> {
  const { samples, before } = await page.evaluate(async ({ holds, ms, scrollTo: y, anchor }) => {
    const top = () => document.querySelector(anchor)?.getBoundingClientRect().top ?? null;
    const frame = () => new Promise((done) => requestAnimationFrame(done));
    const start = top();
    scrollTo(0, y);
    await frame();
    await frame();
    const seen: { present: boolean; top: number | null }[] = [];
    for (
      const end = Date.now() + ms;
      Date.now() < end;
      await new Promise((r) => setTimeout(r, 50))
    ) {
      seen.push({ present: document.querySelector(holds) !== null, top: top() });
    }
    return { samples: seen, before: start === null ? null : start - y };
  }, step);
  const problem = holdProblem(samples, before);
  if (problem)
    throw new Error(`holds ${step.holds} after scrolling to ${step.scrollTo}: ${problem}`);
}
