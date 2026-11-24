import { describe, expect, test } from "bun:test";
import { layoutZodErrors } from "./layout-bundle";

const GENERATED = ".svelte-kit/generated/build/client-optimized";
const START = "../../node_modules/@sveltejs/kit/src/runtime/client/entry.js";

const manifest = {
  [`${GENERATED}/nodes/0.js`]: { file: "nodes/0.js", imports: ["_belt.js"], isEntry: true },
  [`${GENERATED}/app.js`]: { file: "entry/app.js", imports: ["_hooks.js"], isEntry: true },
  [START]: { file: "entry/start.js", isEntry: true },
  "_belt.js": { file: "chunks/belt.js", imports: ["_shared.js"] },
  "_shared.js": { file: "chunks/shared.js" },
  "_hooks.js": { file: "chunks/hooks.js" },
  [`${GENERATED}/nodes/9.js`]: { file: "nodes/9.js", imports: ["_settings.js"], isEntry: true },
  "_settings.js": { file: "chunks/settings.js" },
};

const files = (zod: string) => (file: string) =>
  file === zod ? "class ZodError extends Error {}" : "export {}";

describe("the every-page bundle check", () => {
  test("passes when Zod is only in a route that is not on every page", () => {
    expect(layoutZodErrors(manifest, files("chunks/settings.js"))).toEqual([]);
  });

  test.each([
    ["deep in the layout's closure", "chunks/shared.js"],
    ["in a chunk the app entry imports, as hooks.client.ts would", "chunks/hooks.js"],
    ["in the start entry", "entry/start.js"],
  ])("fails on Zod %s", (_where, file) => {
    expect(layoutZodErrors(manifest, files(file))).toEqual([
      `${file} is loaded by every page and contains Zod`,
    ]);
  });

  test("fails closed when an every-page entry is missing from the manifest", () => {
    const { [`${GENERATED}/app.js`]: _app, ...noApp } = manifest;
    expect(layoutZodErrors(noApp, files(""))[0]).toContain("no app entry (app.js)");
    expect(layoutZodErrors(null, files(""))[0]).toContain("no layout node (nodes/0.js)");
  });
});
