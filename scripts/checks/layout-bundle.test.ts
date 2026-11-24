import { describe, expect, test } from "bun:test";
import { layoutZodErrors } from "./layout-bundle";

const LAYOUT = ".svelte-kit/generated/build/client-optimized/nodes/0.js";

const manifest = {
  [LAYOUT]: { file: "nodes/0.js", imports: ["_belt.js"], isEntry: true },
  "_belt.js": { file: "chunks/belt.js", imports: ["_shared.js"] },
  "_shared.js": { file: "chunks/shared.js" },
  "_settings.js": { file: "chunks/settings.js" },
};

const files = (zod: string) => (file: string) =>
  file === zod ? "class ZodError extends Error {}" : "export {}";

describe("the layout bundle check", () => {
  test("passes when nothing the layout loads contains Zod", () => {
    expect(layoutZodErrors(manifest, files("chunks/settings.js"))).toEqual([]);
  });

  test("fails on Zod anywhere in the layout's import closure", () => {
    expect(layoutZodErrors(manifest, files("chunks/shared.js"))).toEqual([
      "chunks/shared.js is loaded by every page through the layout and contains Zod",
    ]);
  });

  test("fails closed when the manifest has no layout node", () => {
    expect(layoutZodErrors({}, files(""))[0]).toContain("no layout node");
    expect(layoutZodErrors(null, files(""))[0]).toContain("no layout node");
  });
});
