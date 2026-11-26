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
    const held = release(page, step.release);
    if (held === null) throw new Error(`release: no stall step names ${step.release}`);
    if (held === 0) throw new Error(`release: no request to ${step.release} was held`);
  },
};
