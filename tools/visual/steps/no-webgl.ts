import { type StepRunner, wrongKind } from "../step.ts";

declare module "../step.ts" {
  interface StepKinds {
    noWebgl: { noWebgl: true | "after-probe" };
  }
}

const refuseWebgl = (allowed: number) => `{
  const real = HTMLCanvasElement.prototype.getContext;
  let asked = 0;
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    value(kind, ...rest) {
      if (/webgl/i.test(kind) && asked++ >= ${allowed}) return null;
      return Reflect.apply(real, this, [kind, ...rest]);
    },
  });
}`;

export const step: StepRunner = {
  kind: "noWebgl",
  run: async (page, step) => {
    if (!("noWebgl" in step)) throw wrongKind("noWebgl", step);
    await page.addInitScript({ content: refuseWebgl(step.noWebgl === "after-probe" ? 1 : 0) });
    await page.reload({ waitUntil: "load" });
  },
};
