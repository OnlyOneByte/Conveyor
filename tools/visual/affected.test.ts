import { expect, test } from "bun:test";
import { join } from "node:path";
import {
  entriesFor,
  landsElsewhere,
  pageDirFor,
  pageDirs,
  scenePaths,
  selectScenes,
} from "./affected.ts";
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
  expect(scenePaths(forward)).toEqual(["/jobs", "/", "/jobs/scene-forward"]);
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
  expect(pageDirs(root)).toContain("history/[jobId]");
});

test("a scene lands only on its own pages", () => {
  const detail = scenes.find((s) => s.name === "job-detail");
  const forward = scenes.find((s) => s.name === "print-forward");
  if (!detail || !forward) throw new Error("scenes renamed");
  const dirs = pageDirs(root);
  expect(landsElsewhere(dirs, detail, "/jobs/seed-canceled")).toBe(false);
  expect(landsElsewhere(dirs, detail, "/settings")).toBe(true);
  expect(landsElsewhere(dirs, forward, "/jobs/any-new-id")).toBe(false);
});

test("one page's change captures only the scenes that reach it", () => {
  expect(named("packages/web/src/routes/settings/+page.svelte")).toEqual([
    "printer-answering",
    "settings",
    "settings-add",
    "settings-delete",
    "settings-delete-focus-next",
    "settings-delete-focus-middle",
    "settings-delete-focus-previous",
    "settings-delete-focus-plain",
    "settings-delete-focus-empty",
    "belt-region",
    "printers-hold",
    "printers-hold-details",
    "printers-hold-confirm",
    "printers",
    "printers-keys",
    "printers-add-invalid",
    "printers-add",
    "printers-touch",
    "printers-delete",
    "offline-nav",
    "printers-clear-secrets",
    "printers-clear-secrets-keep",
    "printers-clear-secrets-confirm",
    "printers-clear-secrets-double",
    "printers-clear-secrets-keyboard",
    "printers-clear-secrets-reset",
    "printers-clear-secrets-fails",
    "first-run-make",
    "first-run-add",
    "first-run-printers",
    "first-run-limited",
    "loading-make",
    "loading-job",
    "loading-printers",
    "loading-settings",
    "loading-job-failed",
    "loading-printers-add",
  ]);
  const receipt = named("packages/web/src/lib/components/JobReceipt.svelte");
  expect(receipt).toContain("receipt-printed");
  expect(receipt).toContain("print-forward");
  expect(receipt).not.toContain("settings");
  expect(receipt).toContain("job-detail");
  expect(receipt).toContain("job-detail-failed");
  expect(named("packages/web/src/lib/job-live.test.ts", "docs/x.md")).toEqual([]);
});

test("shared styles, tooling, other packages and deleted files capture everything", () => {
  for (const changed of [
    "packages/web/src/lib/styles/tokens.css",
    "tools/visual/capture.ts",
    "packages/api/src/index.ts",
    "bun.lock",
    "packages/web/src/routes/gone/+page.svelte",
    "packages/web/src/app.html",
    "packages/web/src/hooks.server.ts",
    "packages/web/src/service-worker/index.ts",
  ])
    expect(pick(changed).all).toBe(true);
});
