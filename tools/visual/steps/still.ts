import { type StepRunner, wrongKind } from "../step.ts";
import { assertStill } from "../still.ts";

declare module "../step.ts" {
  interface StepKinds {
    still: { still: string; ms: number };
  }
}

export const step: StepRunner = {
  kind: "still",
  run: async (page, step) => {
    if (!("still" in step)) throw wrongKind("still", step);
    await assertStill(page, step);
  },
};
