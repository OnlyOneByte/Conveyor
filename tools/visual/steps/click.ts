import { type StepRunner, wrongKind } from "../step.ts";

declare module "../step.ts" {
  interface StepKinds {
    click: { click: string };
  }
}

export const step: StepRunner = {
  kind: "click",
  run: async (page, step) => {
    if (!("click" in step)) throw wrongKind("click", step);
    await page.locator(step.click).first().click();
  },
};
