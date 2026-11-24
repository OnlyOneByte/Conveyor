import { type StepRunner, wrongKind } from "../step.ts";

declare module "../step.ts" {
  interface StepKinds {
    waitFor: { waitFor: string; timeout?: number; warn?: string };
  }
}

export const step: StepRunner = {
  kind: "waitFor",
  run: async (page, step, warnings) => {
    if (!("waitFor" in step)) throw wrongKind("waitFor", step);
    try {
      await page
        .locator(step.waitFor)
        .first()
        .waitFor({ timeout: step.timeout ?? 15000 });
    } catch (err) {
      if (!step.warn) throw err;
      warnings.push(step.warn);
    }
  },
};
