import { scrollTo } from "../scroll.ts";
import { type StepRunner, wrongKind } from "../step.ts";

declare module "../step.ts" {
  interface StepKinds {
    scroll: { scroll: string };
  }
}

export const step: StepRunner = {
  kind: "scroll",
  run: async (page, step) => {
    if (!("scroll" in step)) throw wrongKind("scroll", step);
    await scrollTo(page, step.scroll);
  },
};
