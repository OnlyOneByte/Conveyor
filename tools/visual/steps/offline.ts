import { cutEditor } from "../offline.ts";
import { type StepRunner, wrongKind } from "../step.ts";

declare module "../step.ts" {
  interface StepKinds {
    offline: { offline: "editor" };
  }
}

export const step: StepRunner = {
  kind: "offline",
  run: async (page, step, _warnings, { root }) => {
    if (!("offline" in step)) throw wrongKind("offline", step);
    await cutEditor(page, root);
  },
};
