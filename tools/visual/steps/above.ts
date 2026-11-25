import { type StepRunner, wrongKind } from "../step.ts";

interface Box {
  getBoundingClientRect(): { top: number; bottom: number };
}

declare module "../step.ts" {
  interface StepKinds {
    above: { above: string; of: string };
  }
}

const box = (el: Box) => {
  const { top, bottom } = el.getBoundingClientRect();
  return { top: Math.round(top), bottom: Math.round(bottom) };
};

export const step: StepRunner = {
  kind: "above",
  run: async (page, step) => {
    if (!("above" in step)) throw wrongKind("above", step);
    const [target, anchor] = [page.locator(step.above).first(), page.locator(step.of).first()];
    await target.waitFor({ timeout: 5000 });
    const [a, b] = [await target.evaluate(box), await anchor.evaluate(box)];
    if (a.bottom > b.top)
      throw new Error(
        `${step.above} ends at ${a.bottom} px, below the top of ${step.of} at ${b.top} px`,
      );
  },
};
