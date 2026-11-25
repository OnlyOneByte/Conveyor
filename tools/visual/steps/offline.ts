import { blockEditor, recordWrites } from "../offline.ts";
import { type StepRunner, wrongKind } from "../step.ts";

declare module "../step.ts" {
  interface StepKinds {
    offline: { offline: string; uncache?: string; only?: "editor" };
  }
}

interface Cache {
  keys(): Promise<{ url: string }[]>;
  delete(request: { url: string }): Promise<boolean>;
}
declare const navigator: { serviceWorker: { ready: Promise<unknown>; controller: unknown } };
declare const caches: { keys(): Promise<string[]>; open(name: string): Promise<Cache> };

export const step: StepRunner = {
  kind: "offline",
  run: async (page, step, _warnings, { root }) => {
    if (!("offline" in step)) throw wrongKind("offline", step);
    recordWrites(page);
    if (step.only === "editor") {
      await blockEditor(page, root);
      await page.locator(step.offline).first().waitFor();
      return;
    }
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await page.reload({ waitUntil: "load" });
    await page.locator(step.offline).first().waitFor();
    if (!(await page.evaluate(() => navigator.serviceWorker.controller !== null)))
      throw new Error("offline: no service worker controls the page after a reload");
    if (step.uncache) {
      const dropped = await page.evaluate(async (pattern) => {
        let count = 0;
        for (const name of await caches.keys()) {
          const cache = await caches.open(name);
          for (const request of await cache.keys())
            if (new URL(request.url).pathname.includes(pattern) && (await cache.delete(request)))
              count++;
        }
        return count;
      }, step.uncache);
      if (dropped === 0) throw new Error(`offline: nothing cached matches ${step.uncache}`);
    }
    await page.context().setOffline(true);
  },
};
