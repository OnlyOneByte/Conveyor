import { assertHolds } from "../holds.ts";
import { type StepRunner, wrongKind } from "../step.ts";

declare module "../step.ts" {
  interface StepKinds {
    holds: { holds: string; ms: number; scrollTo: number; anchor: string };
  }
}

export const step: StepRunner = {
  kind: "holds",
  run: async (page, step) => {
    if (!("holds" in step)) throw wrongKind("holds", step);
    await assertHolds(page, step);
  },
};
