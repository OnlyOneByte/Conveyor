import { type StepRunner, wrongKind } from "../step.ts";

declare module "../step.ts" {
  interface StepKinds {
    hover: { hover: string };
  }
}

export const step: StepRunner = {
  kind: "hover",
  run: async (page, step) => {
    if (!("hover" in step)) throw wrongKind("hover", step);
    await page.locator(step.hover).first().hover();
  },
};
