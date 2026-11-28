import { readFileSync } from "node:fs";
import { join } from "node:path";
import { closure, parseManifest, routeNodes } from "../../../scripts/checks/bundle/measure.ts";
import { type StepRunner, wrongKind } from "../step.ts";
import { hold } from "./stall.ts";

declare module "../step.ts" {
  interface StepKinds {
    lazy: { lazy: string; fail?: boolean; from?: string; spare?: string };
  }
}

export function lazyChunks(root: string, route: string, from?: string, spare?: string): string[] {
  const output = join(root, "packages/web/.svelte-kit/output");
  const manifest = parseManifest(readFileSync(join(output, "client/.vite/manifest.json"), "utf8"));
  const nodes = routeNodes(readFileSync(join(output, "server/manifest.js"), "utf8")).get(route);
  if (!nodes) throw new Error(`lazy: no route ${route} in the server manifest`);
  const keys = Object.keys(manifest);
  const entries = keys.filter((key) => manifest[key]?.isEntry && !key.includes("/nodes/"));
  const leaves = keys.filter((key) => nodes.some((n) => key.endsWith(`/nodes/${n}.js`)));
  const leavesOf = (r: string) => {
    const ids = routeNodes(readFileSync(join(output, "server/manifest.js"), "utf8")).get(r);
    if (!ids) throw new Error(`lazy: no route ${r} in the server manifest`);
    return keys.filter((key) => ids.some((n) => key.endsWith(`/nodes/${n}.js`)));
  };
  const first = closure(manifest, [...entries, ...leaves, ...(from ? leavesOf(from) : [])]);
  const later = new Set<string>();
  let reached = [...closure(manifest, leaves)];
  while (reached.length) {
    const next = keys
      .filter((key) => reached.includes(manifest[key]?.file ?? ""))
      .flatMap((key) => manifest[key]?.dynamicImports ?? [])
      .filter((key) => !later.has(key));
    for (const key of next) later.add(key);
    reached = [...closure(manifest, next)];
  }
  const kept = spare
    ? closure(
        manifest,
        keys.filter((key) => key.includes(spare)),
      )
    : new Set();
  const lazy = [...closure(manifest, [...later])].filter(
    (f) => f.endsWith(".js") && !first.has(f) && !kept.has(f),
  );
  if (lazy.length === 0) throw new Error(`lazy: ${route} imports nothing on demand`);
  return lazy;
}

export const step: StepRunner = {
  kind: "lazy",
  run: async (page, step, _warnings, { root }) => {
    if (!("lazy" in step)) throw wrongKind("lazy", step);
    const held = hold(page, step.lazy);
    for (const file of lazyChunks(root, step.lazy, step.from, step.spare))
      await page.route(`**/${file}`, async (route) => {
        if (step.fail || (await held())) return route.abort("internetdisconnected");
        return route.continue().catch((err: unknown) => {
          if (!page.isClosed()) throw err;
        });
      });
    await page.reload({ waitUntil: "load" });
  },
};
