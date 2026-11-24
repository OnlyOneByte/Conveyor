import type { Page } from "playwright";
import type { Step } from "./scene.ts";

export const JUMP_MS = 1;

type Still = Extract<Step, { still: string }>;

interface Node {
  tagName: string;
  className: unknown;
}

declare const document: {
  querySelector(selector: string): (Node & { contains(other: unknown): boolean }) | null;
  getAnimations(): {
    effect: { target?: Node | null; getComputedTiming(): { duration?: number | string } } | null;
  }[];
};

export interface Moving {
  target: string;
  duration: number;
}

export function stillProblem(samples: Moving[][]): string | null {
  if (samples.length === 0) return "no samples were taken";
  const at = samples.findIndex((seen) => seen.some((m) => m.duration >= JUMP_MS));
  if (at < 0) return null;
  const first = samples[at]?.find((m) => m.duration >= JUMP_MS);
  return `${first?.target} animates for ${first?.duration} ms at sample ${at} of ${samples.length}`;
}

export async function assertStill(page: Page, step: Still): Promise<void> {
  const samples = await page.evaluate(async ({ still, ms }) => {
    const seen: { target: string; duration: number }[][] = [];
    for (
      const end = Date.now() + ms;
      Date.now() < end;
      await new Promise((r) => setTimeout(r, 50))
    ) {
      const root = document.querySelector(still);
      seen.push(
        document.getAnimations().flatMap(({ effect }) => {
          const target = effect?.target;
          if (!root || !target || !root.contains(target)) return [];
          const duration = effect.getComputedTiming().duration;
          const name = `${target.tagName.toLowerCase()}.${String(target.className).trim().split(/\s+/)[0]}`;
          return [{ target: name, duration: typeof duration === "number" ? duration : 0 }];
        }),
      );
    }
    return seen;
  }, step);
  const problem = stillProblem(samples);
  if (problem) throw new Error(`still ${step.still}: ${problem}`);
}
