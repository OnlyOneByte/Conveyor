import { type StepRunner, wrongKind } from "../step.ts";

interface Box {
  getBoundingClientRect(): { top: number; bottom: number };
}

declare module "../step.ts" {
  interface StepKinds {
    sameLine: { sameLine: readonly [string, string] };
  }
}

const span = async (page: Parameters<StepRunner["run"]>[0], selector: string) => {
  const target = page.locator(selector).first();
  await target.waitFor({ timeout: 5000 });
  return target.evaluate((el: Box) => {
    const { top, bottom } = el.getBoundingClientRect();
    return { top, bottom };
  });
};

export const step: StepRunner = {
  kind: "sameLine",
  run: async (page, step) => {
    if (!("sameLine" in step)) throw wrongKind("sameLine", step);
    const [first, second] = step.sameLine;
    const a = await span(page, first);
    const b = await span(page, second);
    const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    const shorter = Math.min(a.bottom - a.top, b.bottom - b.top);
    if (overlap < shorter / 2)
      throw new Error(
        `${first} (${Math.round(a.top)}–${Math.round(a.bottom)} px) and ${second} ` +
          `(${Math.round(b.top)}–${Math.round(b.bottom)} px) don't share a line: ` +
          `they overlap by ${Math.max(0, Math.round(overlap))} px of ${Math.round(shorter)}`,
      );
  },
};
