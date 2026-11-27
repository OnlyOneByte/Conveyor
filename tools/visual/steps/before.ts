import { type StepRunner, wrongKind } from "../step.ts";

declare module "../step.ts" {
  interface StepKinds {
    before: { before: string; of: string };
  }
}

const FOLLOWING = 4;

export const step: StepRunner = {
  kind: "before",
  run: async (page, step) => {
    if (!("before" in step)) throw wrongKind("before", step);
    const other = await page.locator(step.of).first().elementHandle();
    if (!other) throw new Error(`before: ${step.of} isn't on the page`);
    const first = await page
      .locator(step.before)
      .first()
      .evaluate((el, arg) => Boolean(el.compareDocumentPosition(arg.of) & arg.following), {
        of: other,
        following: FOLLOWING,
      });
    if (!first) throw new Error(`before: ${step.before} doesn't come before ${step.of} in the DOM`);
  },
};
