import { readFileSync } from "node:fs";
import { join } from "node:path";
import { closure, parseManifest, routeNodes } from "../../../scripts/checks/bundle/measure.ts";
import { type StepRunner, wrongKind } from "../step.ts";
import { hold } from "./stall.ts";

declare module "../step.ts" {
  interface StepKinds {
    lazy: { lazy: string; fail?: boolean };
  }
}

export function lazyChunks(root: string, route: string): string[] {
  const output = join(root, "packages/web/.svelte-kit/output");
  const manifest = parseManifest(readFileSync(join(output, "client/.vite/manifest.json"), "utf8"));
  const nodes = routeNodes(readFileSync(join(output, "server/manifest.js"), "utf8")).get(route);
  if (!nodes) throw new Error(`lazy: no route ${route} in the server manifest`);
  const keys = Object.keys(manifest);
  const entries = keys.filter((key) => manifest[key]?.isEntry && !key.includes("/nodes/"));
  const leaves = keys.filter((key) => nodes.some((n) => key.endsWith(`/nodes/${n}.js`)));
  const first = closure(manifest, [...entries, ...leaves]);
  const own = [...closure(manifest, leaves)];
  const imported = keys.filter((key) => own.includes(manifest[key]?.file ?? ""));
  const later = imported.flatMap((key) => manifest[key]?.dynamicImports ?? []);
  const lazy = [...closure(manifest, later)].filter((f) => f.endsWith(".js") && !first.has(f));
  if (lazy.length === 0) throw new Error(`lazy: ${route} imports nothing on demand`);
  return lazy;
}

export const step: StepRunner = {
  kind: "lazy",
  run: async (page, step, _warnings, { root }) => {
    if (!("lazy" in step)) throw wrongKind("lazy", step);
    const held = hold(page, step.lazy);
    for (const file of lazyChunks(root, step.lazy))
      await page.route(`**/${file}`, async (route) => {
        if (step.fail) return route.abort("internetdisconnected");
        await held();
        return route.continue().catch((err: unknown) => {
          if (!page.isClosed()) throw err;
        });
      });
    await page.reload({ waitUntil: "load" });
  },
};
