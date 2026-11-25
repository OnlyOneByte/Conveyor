import { assertRing } from "../ring.ts";
import { type StepRunner, wrongKind } from "../step.ts";

declare module "../step.ts" {
  interface StepKinds {
    ring: { ring: string };
  }
}

export const step: StepRunner = {
  kind: "ring",
  run: async (page, step) => {
    if (!("ring" in step)) throw wrongKind("ring", step);
    await assertRing(page, step.ring);
  },
};
