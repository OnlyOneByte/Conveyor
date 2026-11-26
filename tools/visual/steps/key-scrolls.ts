import { assertKeyScrolls } from "../ring.ts";
import { type StepRunner, wrongKind } from "../step.ts";

declare module "../step.ts" {
  interface StepKinds {
    keyScrolls: { keyScrolls: string };
  }
}

export const step: StepRunner = {
  kind: "keyScrolls",
  run: async (page, step) => {
    if (!("keyScrolls" in step)) throw wrongKind("keyScrolls", step);
    await assertKeyScrolls(page, step.keyScrolls);
  },
};
