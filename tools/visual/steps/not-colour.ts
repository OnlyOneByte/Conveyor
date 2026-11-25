import { type StepRunner, wrongKind } from "../step.ts";

interface Styled {
  parentElement: Styled | null;
  style: { color: string };
  ownerDocument: {
    createElement(tag: string): Styled;
    defaultView: { getComputedStyle(el: Styled): { color: string } } | null;
  };
  append(child: Styled): void;
  remove(): void;
}

declare module "../step.ts" {
  interface StepKinds {
    notColour: { notColour: string; token: string };
  }
}

export const step: StepRunner = {
  kind: "notColour",
  run: async (page, step) => {
    if (!("notColour" in step)) throw wrongKind("notColour", step);
    const target = page.locator(step.notColour).first();
    await target.waitFor({ timeout: 5000 });
    const { own, token } = await target.evaluate((el: Styled, name: string) => {
      const view = el.ownerDocument.defaultView;
      const probe = el.ownerDocument.createElement("span");
      probe.style.color = `var(${name})`;
      (el.parentElement ?? el).append(probe);
      const resolved = view?.getComputedStyle(probe).color ?? "";
      probe.remove();
      return { own: view?.getComputedStyle(el).color ?? "", token: resolved };
    }, step.token);
    if (own === token) throw new Error(`${step.notColour} is drawn in ${step.token} (${own})`);
  },
};
