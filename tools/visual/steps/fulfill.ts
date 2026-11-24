import { type StepRunner, wrongKind } from "../step.ts";

declare module "../step.ts" {
  interface StepKinds {
    fulfill: { fulfill: string; method?: string; status: number; json: unknown };
  }
}

export const step: StepRunner = {
  kind: "fulfill",
  run: async (page, step) => {
    if (!("fulfill" in step)) throw wrongKind("fulfill", step);
    const { method, status, json } = step;
    await page.route(step.fulfill, (route) =>
      method && route.request().method() !== method
        ? route.fallback()
        : route.fulfill({ status, json }),
    );
  },
};
