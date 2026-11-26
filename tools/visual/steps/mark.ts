import { type StepRunner, wrongKind } from "../step.ts";

declare module "../step.ts" {
  interface StepKinds {
    mark: { mark: string };
  }
}

export const step: StepRunner = {
  kind: "mark",
  run: async (page, step) => {
    if (!("mark" in step)) throw wrongKind("mark", step);
    const target = page.locator(step.mark).first();
    await target.waitFor({ timeout: 5000 });
    await target.evaluate((el: { setAttribute(name: string, value: string): void }) =>
      el.setAttribute("data-mark", ""),
    );
  },
};
