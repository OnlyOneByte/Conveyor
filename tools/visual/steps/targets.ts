import { type StepRunner, wrongKind } from "../step.ts";
import { assertTargets } from "../targets.ts";

declare module "../step.ts" {
  interface StepKinds {
    targets: { targets: string };
  }
}

export const step: StepRunner = {
  kind: "targets",
  run: async (page, step) => {
    if (!("targets" in step)) throw wrongKind("targets", step);
    await assertTargets(page, step.targets);
  },
};
