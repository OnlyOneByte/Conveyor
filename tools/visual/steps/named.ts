import { type StepRunner, wrongKind } from "../step.ts";

declare module "../step.ts" {
  interface StepKinds {
    named: { named: string };
  }
}

const squash = (text: string) =>
  text
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

export const step: StepRunner = {
  kind: "named",
  run: async (page, step) => {
    if (!("named" in step)) throw wrongKind("named", step);
    const target = page.locator(step.named).first();
    const [label, text] = await Promise.all([
      target.getAttribute("aria-label"),
      target.textContent(),
    ]);
    const shown = text ?? "";
    const name = label ?? shown;
    if (!squash(name).includes(squash(shown)))
      throw new Error(`named: ${step.named} is named "${name}" but shows "${shown}" (WCAG 2.5.3)`);
  },
};
