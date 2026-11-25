import { type StepRunner, wrongKind } from "../step.ts";

interface Clickable {
  click(): void;
}

declare module "../step.ts" {
  interface StepKinds {
    poke: { poke: string };
  }
}

export const step: StepRunner = {
  kind: "poke",
  run: async (page, step) => {
    if (!("poke" in step)) throw wrongKind("poke", step);
    const found = await page.locator(step.poke).count();
    if (found === 0) throw new Error(`poke found nothing matching ${step.poke}`);
    await page.locator(step.poke).evaluateAll((all: Clickable[]) => {
      for (const el of all) el.click();
    });
  },
};
