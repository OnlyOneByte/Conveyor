import { type StepRunner, wrongKind } from "../step.ts";

interface Edges {
  getBoundingClientRect(): { left: number; right: number };
}

declare module "../step.ts" {
  interface StepKinds {
    aligns: { aligns: string; with: string };
  }
}

const edges = (el: Edges) => {
  const { left, right } = el.getBoundingClientRect();
  return { left: Math.round(left), right: Math.round(right) };
};

export const step: StepRunner = {
  kind: "aligns",
  run: async (page, step) => {
    if (!("aligns" in step)) throw wrongKind("aligns", step);
    const [target, anchor] = [page.locator(step.aligns).first(), page.locator(step.with).first()];
    await target.waitFor({ timeout: 5000 });
    const [a, b] = [await target.evaluate(edges), await anchor.evaluate(edges)];
    if (a.left !== b.left || a.right !== b.right)
      throw new Error(
        `${step.aligns} spans ${a.left}–${a.right} px, but ${step.with} spans ${b.left}–${b.right} px`,
      );
  },
};
