import type { Page } from "playwright";
import type { Step } from "./scenes.ts";

export const MAX_SHIFT_PX = 4;

type Hold = Extract<Step, { holds: string }>;

export const SETTLE_MS = 2000;

declare const document: {
  querySelector(selector: string): { getBoundingClientRect(): { top: number } } | null;
  documentElement: { scrollHeight: number };
};
declare const scrollY: number;
declare const innerHeight: number;
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

export interface Settled {
  present: boolean;
  scrollY: number;
  room: number;
}

export const settleProblem = (settled: Settled): string | null =>
  settled.present
    ? null
    : `never appeared within ${SETTLE_MS} ms; the page scrolled to ${Math.round(settled.scrollY)} px of ${Math.round(settled.room)} px of room`;

export async function assertHolds(page: Page, step: Hold): Promise<void> {
  const settleMs = SETTLE_MS;
  const { samples, before, settled } = await page.evaluate(
    async ({ holds, ms, y, anchor, settleMs }) => {
      const top = () => document.querySelector(anchor)?.getBoundingClientRect().top ?? null;
      const present = () => document.querySelector(holds) !== null;
      const start = top();
      scrollTo(0, y);
      for (const until = Date.now() + settleMs; !present() && Date.now() < until; ) {
        await new Promise((r) => setTimeout(r, 16));
      }
      const settled = {
        present: present(),
        scrollY,
        room: document.documentElement.scrollHeight - innerHeight,
      };
      const seen: { present: boolean; top: number | null }[] = [];
      for (
        const end = Date.now() + ms;
        Date.now() < end;
        await new Promise((r) => setTimeout(r, 50))
      ) {
        seen.push({ present: present(), top: top() });
      }
      return { samples: seen, before: start === null ? null : start - y, settled };
    },
    { holds: step.holds, ms: step.ms, y: step.scrollTo, anchor: step.anchor, settleMs },
  );
  const problem = settleProblem(settled) ?? holdProblem(samples, before);
  if (problem)
    throw new Error(`holds ${step.holds} after scrolling to ${step.scrollTo}: ${problem}`);
}
