import { type StepRunner, wrongKind } from "../step.ts";

interface Box {
  getBoundingClientRect(): { top: number; bottom: number };
  closest(selector: string): Frame | null;
}

interface Frame {
  getBoundingClientRect(): { top: number };
  clientTop: number;
  clientHeight: number;
}

declare module "../step.ts" {
  interface StepKinds {
    centred: { centred: string; in: string };
  }
}

export const step: StepRunner = {
  kind: "centred",
  run: async (page, step) => {
    if (!("centred" in step)) throw wrongKind("centred", step);
    const target = page.locator(step.centred).first();
    await target.waitFor({ timeout: 5000 });
    const found = await target.evaluate((el: Box, outer: string) => {
      const frame = el.closest(outer);
      if (!frame) return null;
      const box = el.getBoundingClientRect();
      const top = frame.getBoundingClientRect().top + frame.clientTop;
      return { own: (box.top + box.bottom) / 2, frame: top + frame.clientHeight / 2 };
    }, step.in);
    if (!found) throw new Error(`${step.centred} has no ${step.in} around it`);
    const off = found.own - found.frame;
    if (Math.abs(off) > 1)
      throw new Error(
        `${step.centred} sits ${Math.abs(off).toFixed(1)} px ${off < 0 ? "above" : "below"} ` +
          `the middle of its ${step.in}, more than 1 px`,
      );
  },
};
