import { travel } from "../follow.ts";
import { type StepRunner, wrongKind } from "../step.ts";

declare module "../step.ts" {
  interface StepKinds {
    history: { history: "back" | "forward"; url?: string };
  }
}

export const step: StepRunner = {
  kind: "history",
  run: async (page, step) => {
    if (!("history" in step)) throw wrongKind("history", step);
    await travel(page, step.history, step.url);
  },
};
