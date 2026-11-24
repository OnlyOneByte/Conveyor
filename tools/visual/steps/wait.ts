import { type StepRunner, wrongKind } from "../step.ts";

export const step: StepRunner = {
  kind: "wait",
  run: async (page, step) => {
    if (!("wait" in step)) throw wrongKind("wait", step);
    await page.waitForTimeout(step.wait);
  },
};
