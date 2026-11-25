import { assertHits, type Viewport } from "../hits.ts";
import { type StepRunner, wrongKind } from "../step.ts";

declare module "../step.ts" {
  interface StepKinds {
    hits: { hits: string; viewports: readonly Viewport[] };
  }
}

export const step: StepRunner = {
  kind: "hits",
  run: async (page, step) => {
    if (!("hits" in step)) throw wrongKind("hits", step);
    await assertHits(page, step.hits, step.viewports);
  },
};
