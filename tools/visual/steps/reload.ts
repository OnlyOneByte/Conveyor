import { type StepRunner, wrongKind } from "../step.ts";

declare module "../step.ts" {
  interface StepKinds {
    reload: { reload: true };
  }
}

export const step: StepRunner = {
  kind: "reload",
  run: async (page, step) => {
    if (!("reload" in step)) throw wrongKind("reload", step);
    await page.reload({ waitUntil: "load" });
  },
};
