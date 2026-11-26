import { type StepRunner, wrongKind } from "../step.ts";

interface Box {
  getBoundingClientRect(): { top: number; bottom: number };
}

declare module "../step.ts" {
  interface StepKinds {
    inside: { inside: string; of: string };
  }
}

const box = (el: Box) => {
  const { top, bottom } = el.getBoundingClientRect();
  return { top: Math.round(top), bottom: Math.round(bottom) };
};

export const step: StepRunner = {
  kind: "inside",
  run: async (page, step) => {
    if (!("inside" in step)) throw wrongKind("inside", step);
    const [target, frame] = [page.locator(step.inside).first(), page.locator(step.of).first()];
    await target.waitFor({ timeout: 5000 });
    const [a, b] = [await target.evaluate(box), await frame.evaluate(box)];
    if (a.top < b.top || a.bottom > b.bottom)
      throw new Error(
        `${step.inside} spans ${a.top}–${a.bottom} px, outside ${step.of} at ${b.top}–${b.bottom} px`,
      );
  },
};
