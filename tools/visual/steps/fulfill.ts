import { type StepRunner, wrongKind } from "../step.ts";

declare module "../step.ts" {
  interface StepKinds {
    fulfill: {
      fulfill: string;
      method?: string;
      status: number;
      json: unknown;
      delayMs?: number;
      times?: number;
      unless?: string;
    };
  }
}

export const step: StepRunner = {
  kind: "fulfill",
  run: async (page, step) => {
    if (!("fulfill" in step)) throw wrongKind("fulfill", step);
    const { method, status, json, delayMs, times, unless } = step;
    let left = times ?? Number.POSITIVE_INFINITY;
    await page.route(step.fulfill, async (route) => {
      if ((method && route.request().method() !== method) || left <= 0) return route.fallback();
      if (unless && route.request().postData()?.includes(unless)) return route.fallback();
      left -= 1;
      if (delayMs) await Bun.sleep(delayMs);
      return route.fulfill({ status, json });
    });
  },
};
