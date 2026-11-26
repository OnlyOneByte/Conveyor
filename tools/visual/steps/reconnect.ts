import { unblockEditor } from "../offline.ts";
import { type StepRunner, wrongKind } from "../step.ts";

declare module "../step.ts" {
  interface StepKinds {
    reconnect: { reconnect: "editor" };
  }
}

export const step: StepRunner = {
  kind: "reconnect",
  run: async (page, step, _warnings, { root }) => {
    if (!("reconnect" in step)) throw wrongKind("reconnect", step);
    await unblockEditor(page, root);
  },
};
