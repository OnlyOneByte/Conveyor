import { type StepRunner, wrongKind } from "../step.ts";
import { release } from "./stall.ts";

declare module "../step.ts" {
  interface StepKinds {
    release: { release: string };
  }
}

export const step: StepRunner = {
  kind: "release",
  run: async (page, step) => {
    if (!("release" in step)) throw wrongKind("release", step);
    if (!release(page, step.release)) throw new Error(`release: nothing stalls ${step.release}`);
  },
};
