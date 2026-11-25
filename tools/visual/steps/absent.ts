import { type StepRunner, wrongKind } from "../step.ts";

declare module "../step.ts" {
  interface StepKinds {
    absent: { absent: string };
  }
}

export const step: StepRunner = {
  kind: "absent",
  run: async (page, step) => {
    if (!("absent" in step)) throw wrongKind("absent", step);
    const found = await page.locator(step.absent).count();
    if (found > 0) throw new Error(`${step.absent} is on the page (${found}), and should not be`);
  },
};
