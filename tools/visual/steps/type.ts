import { type StepRunner, wrongKind } from "../step.ts";

declare module "../step.ts" {
  interface StepKinds {
    type: { type: string; text: string };
  }
}

export const step: StepRunner = {
  kind: "type",
  run: async (page, step) => {
    if (!("type" in step)) throw wrongKind("type", step);
    await page.locator(step.type).first().fill(step.text);
  },
};
