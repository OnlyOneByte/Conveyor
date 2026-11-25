import { type StepRunner, wrongKind } from "../step.ts";

interface Edge {
  getBoundingClientRect(): { bottom: number };
}

declare module "../step.ts" {
  interface StepKinds {
    bottoms: { bottoms: string; with: string };
  }
}

const bottom = (el: Edge) => Math.round(el.getBoundingClientRect().bottom);

export const step: StepRunner = {
  kind: "bottoms",
  run: async (page, step) => {
    if (!("bottoms" in step)) throw wrongKind("bottoms", step);
    const [target, anchor] = [page.locator(step.bottoms).first(), page.locator(step.with).first()];
    await target.waitFor({ timeout: 5000 });
    const [a, b] = [await target.evaluate(bottom), await anchor.evaluate(bottom)];
    if (a !== b)
      throw new Error(`${step.bottoms} ends at ${a} px, but ${step.with} ends at ${b} px`);
  },
};
