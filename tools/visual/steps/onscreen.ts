import { type StepRunner, wrongKind } from "../step.ts";

declare module "../step.ts" {
  interface StepKinds {
    onscreen: { onscreen: string };
  }
}

export const step: StepRunner = {
  kind: "onscreen",
  run: async (page, step) => {
    if (!("onscreen" in step)) throw wrongKind("onscreen", step);
    const at = await page
      .locator(step.onscreen)
      .first()
      .evaluate((el) => {
        const root = el.ownerDocument.documentElement;
        return {
          top: Math.round(el.getBoundingClientRect().top + root.scrollTop),
          height: root.clientHeight,
        };
      });
    if (at.top < 0 || at.top >= at.height)
      throw new Error(
        `onscreen: ${step.onscreen} starts at ${at.top} px, outside the first ${at.height} px`,
      );
  },
};
