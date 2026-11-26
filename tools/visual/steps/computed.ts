import { type StepRunner, wrongKind } from "../step.ts";

interface Styled {
  ownerDocument: {
    defaultView: {
      getComputedStyle(el: Styled, pseudo?: string): { getPropertyValue(name: string): string };
    } | null;
  };
}

declare module "../step.ts" {
  interface StepKinds {
    computed: { computed: string; pseudo?: string; property: string; matches: string };
  }
}

export const step: StepRunner = {
  kind: "computed",
  run: async (page, step) => {
    if (!("computed" in step)) throw wrongKind("computed", step);
    const target = page.locator(step.computed).first();
    await target.waitFor({ timeout: 5000 });
    const value = await target.evaluate(
      (el: Styled, { pseudo, property }: { pseudo?: string; property: string }) =>
        el.ownerDocument.defaultView?.getComputedStyle(el, pseudo).getPropertyValue(property) ?? "",
      { pseudo: step.pseudo, property: step.property },
    );
    if (!new RegExp(step.matches).test(value))
      throw new Error(
        `${step.computed}${step.pseudo ?? ""} ${step.property} is "${value}", which doesn't match /${step.matches}/`,
      );
  },
};
