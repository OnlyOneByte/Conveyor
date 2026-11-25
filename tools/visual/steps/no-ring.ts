import { assertNoRing } from "../ring.ts";
import { type StepRunner, wrongKind } from "../step.ts";

declare module "../step.ts" {
  interface StepKinds {
    noRing: { noRing: string };
  }
}

export const step: StepRunner = {
  kind: "noRing",
  run: async (page, step) => {
    if (!("noRing" in step)) throw wrongKind("noRing", step);
    await assertNoRing(page, step.noRing);
  },
};
