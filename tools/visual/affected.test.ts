import { expect, test } from "bun:test";
import { join } from "node:path";
import { entriesFor, pageDirFor, scenePaths, selectScenes } from "./affected.ts";
import { scenes } from "./scenes.ts";

const root = join(import.meta.dir, "../..");
const pick = (...changed: string[]) => selectScenes(root, changed, scenes);
const named = (...changed: string[]) => {
  const s = pick(...changed);
  return s.all ? "all" : s.scenes;
};

test("a scene's pages are its route, its follows, its Back/Forward landings and its visits", () => {
  const find = (name: string) => scenes.find((s) => s.name === name);
  const forward = find("print-forward");
  const retry = find("retry-link");
  if (!forward || !retry) throw new Error("scenes renamed");
  expect(scenePaths(forward)).toEqual(["/history", "/", "/jobs/scene-forward"]);
  expect(scenePaths(retry)).toEqual(["/jobs/seed-failed", "/", "/jobs/seed-printed"]);
});

test("routes map to page folders, a fixed folder before a parameter", () => {
  const dirs = ["", "history", "history/[jobId]", "jobs/[id]", "primitives", "primitives/track"];
  expect(pageDirFor(dirs, "/")).toBe("");
  expect(pageDirFor(dirs, "/history/seed-failed")).toBe("history/[jobId]");
  expect(pageDirFor(dirs, "/primitives/track")).toBe("primitives/track");
  expect(pageDirFor(dirs, "/no-such-page")).toBeNull();
  expect(entriesFor(null)).toContain("packages/web/src/routes/+error.svelte");
  expect(entriesFor("jobs/[id]")).toContain("packages/web/src/routes/+layout.svelte");
});

test("one page's change captures only the scenes that reach it", () => {
  expect(named("packages/web/src/routes/settings/+page.svelte")).toEqual([
    "settings",
    "printer-form-elegoo",
    "printer-form-moonraker",
  ]);
  const receipt = named("packages/web/src/lib/components/JobReceipt.svelte");
  expect(receipt).toContain("receipt-printed");
  expect(receipt).toContain("print-forward");
  expect(receipt).not.toContain("settings");
  expect(named("packages/web/src/lib/job-live.test.ts", "docs/x.md")).toEqual([]);
});

test("shared styles, tooling, other packages and deleted files capture everything", () => {
  for (const changed of [
    "packages/web/src/lib/styles/tokens.css",
    "tools/visual/capture.ts",
    "packages/api/src/index.ts",
    "bun.lock",
    "packages/web/src/routes/gone/+page.svelte",
  ])
    expect(pick(changed).all).toBe(true);
});
