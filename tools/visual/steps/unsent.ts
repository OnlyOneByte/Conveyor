import { sentSince } from "../offline.ts";
import { type StepRunner, wrongKind } from "../step.ts";

declare module "../step.ts" {
  interface StepKinds {
    unsent: { unsent: string };
  }
}

export const step: StepRunner = {
  kind: "unsent",
  run: async (page, step) => {
    if (!("unsent" in step)) throw wrongKind("unsent", step);
    const sent = sentSince(page).filter((write) => write.startsWith(`${step.unsent} `));
    if (sent.length) throw new Error(`sent ${sent.join(", ")} while the editor was offline`);
  },
};
