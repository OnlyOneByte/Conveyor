import { type StepRunner, wrongKind } from "../step.ts";

declare module "../step.ts" {
  interface StepKinds {
    press: { press: string };
  }
}

export const step: StepRunner = {
  kind: "press",
  run: async (page, step) => {
    if (!("press" in step)) throw wrongKind("press", step);
    await page.keyboard.press(step.press);
  },
};
