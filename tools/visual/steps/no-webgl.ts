import { type StepRunner, wrongKind } from "../step.ts";

declare module "../step.ts" {
  interface StepKinds {
    noWebgl: { noWebgl: true };
  }
}

const REFUSE_WEBGL = `{
  const real = HTMLCanvasElement.prototype.getContext;
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    value(kind, ...rest) {
      return /webgl/i.test(kind) ? null : Reflect.apply(real, this, [kind, ...rest]);
    },
  });
}`;

export const step: StepRunner = {
  kind: "noWebgl",
  run: async (page, step) => {
    if (!("noWebgl" in step)) throw wrongKind("noWebgl", step);
    await page.addInitScript({ content: REFUSE_WEBGL });
    await page.reload({ waitUntil: "load" });
  },
};
