import { type StepRunner, wrongKind } from "../step.ts";

declare module "../step.ts" {
  interface StepKinds {
    fulfill: { fulfill: string; method?: string; status: number; json: unknown; delayMs?: number };
  }
}

export const step: StepRunner = {
  kind: "fulfill",
  run: async (page, step) => {
    if (!("fulfill" in step)) throw wrongKind("fulfill", step);
    const { method, status, json, delayMs } = step;
    await page.route(step.fulfill, async (route) => {
      if (method && route.request().method() !== method) return route.fallback();
      if (delayMs) await Bun.sleep(delayMs);
      return route.fulfill({ status, json });
    });
  },
};
