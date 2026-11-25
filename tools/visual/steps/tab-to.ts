import { tabTo } from "../hits.ts";
import { type StepRunner, wrongKind } from "../step.ts";

declare module "../step.ts" {
  interface StepKinds {
    tabTo: { tabTo: string };
  }
}

export const step: StepRunner = {
  kind: "tabTo",
  run: async (page, step) => {
    if (!("tabTo" in step)) throw wrongKind("tabTo", step);
    await tabTo(page, step.tabTo);
  },
};
