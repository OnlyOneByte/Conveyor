import { follow } from "../follow.ts";
import { type StepRunner, wrongKind } from "../step.ts";

declare module "../step.ts" {
  interface StepKinds {
    follow: { follow: string };
  }
}

export const step: StepRunner = {
  kind: "follow",
  run: async (page, step) => {
    if (!("follow" in step)) throw wrongKind("follow", step);
    await follow(page, step.follow);
  },
};
