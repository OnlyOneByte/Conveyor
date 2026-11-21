import { describe, expect, test } from "bun:test";
import {
  AREAS,
  areaOf,
  areaPath,
  areaWrites,
  LEGACY_BASELINE_PATH,
  parseAreas,
  readAreas,
  serializeAreas,
} from "./areas";
import { type Baseline, serializeBaseline } from "./baseline";
import { checkRatchet } from "./ratchet";
import type { Tree } from "./tree";

const tree = (files: Record<string, string>): Tree => ({
  list: () => Object.keys(files),
  read: (path) => files[path] ?? null,
});

const baseline = (files: Record<string, number>): Baseline => ({
  files: Object.fromEntries(
    Object.entries(files).map(([path, comments]) => [path, { comments, suppressions: 0 }]),
  ),
});

const areaFiles = (files: Record<string, number>) =>
  Object.fromEntries(serializeAreas(baseline(files)));

const CHECKER = { "scripts/checks/comments.ts": "" };

const WEB = "packages/web/src/app.ts";

const API = "packages/api/src/jobs.ts";

const run = (current: Record<string, number>, base: Tree) =>
  checkRatchet({
    current: baseline(current),
    present: new Set(Object.keys(current)),
    committed: readAreas(tree(areaFiles(current))),
    base,
  }).errors;

describe("areaOf", () => {
  test("maps each package, every plugin and the rest of the repo to one area", () => {
    expect(areaOf("packages/api/src/jobs.ts")).toBe("api");
    expect(areaOf("packages/worker/Dockerfile")).toBe("worker");
    expect(areaOf("packages/shared/src/db.ts")).toBe("shared");
    expect(areaOf("packages/web/src/App.svelte")).toBe("web");
    expect(areaOf("plugins/slicers/orca/src/index.ts")).toBe("plugins");
    expect(areaOf("packages/newpkg/src/x.ts")).toBe("repo");
    expect(areaOf("Caddyfile")).toBe("repo");
    expect(areaOf(".github/workflows/ci.yml")).toBe("repo");
  });

  test("names one file per area under the baseline folder", () => {
    expect(AREAS.map(areaPath)).toEqual([
      "scripts/checks/comments/baseline/api.json",
      "scripts/checks/comments/baseline/worker.json",
      "scripts/checks/comments/baseline/shared.json",
      "scripts/checks/comments/baseline/web.json",
      "scripts/checks/comments/baseline/plugins.json",
      "scripts/checks/comments/baseline/repo.json",
    ]);
  });
});

describe("area files", () => {
  test("split a baseline by area, keep nonzero entries only and write every area", () => {
    const files = areaFiles({ [WEB]: 2, [API]: 0, Caddyfile: 1 });
    expect(Object.keys(files)).toEqual(AREAS.map(areaPath));
    expect(files[areaPath("web")]).toBe(serializeBaseline(baseline({ [WEB]: 2 })));
    expect(files[areaPath("repo")]).toBe(serializeBaseline(baseline({ Caddyfile: 1 })));
    expect(files[areaPath("api")]).toBe(serializeBaseline(baseline({})));
  });

  test("join back into the same baseline", () => {
    const original = baseline({ [WEB]: 2, Caddyfile: 1 });
    expect(parseAreas(readAreas(tree(areaFiles({ [WEB]: 2, Caddyfile: 1 }))))).toEqual(original);
  });

  test("no area files at all reads as no baseline", () => {
    expect(parseAreas(readAreas(tree({})))).toBeNull();
  });

  test("a missing area file is an error, not an empty area", () => {
    const files = areaFiles({ [WEB]: 2 });
    delete files[areaPath("plugins")];
    expect(parseAreas(readAreas(tree(files)))).toBe(`${areaPath("plugins")} is missing`);
  });

  test("an invalid area file is an error", () => {
    const files = { ...areaFiles({}), [areaPath("web")]: "not json" };
    expect(parseAreas(readAreas(tree(files)))).toBe(`${areaPath("web")} is not a valid baseline`);
  });

  test("an entry filed under the wrong area is an error", () => {
    const files = {
      ...areaFiles({}),
      [areaPath("api")]: serializeBaseline(baseline({ [WEB]: 1 })),
    };
    expect(parseAreas(readAreas(tree(files)))).toBe(
      `${areaPath("api")} lists ${WEB}, which belongs in ${areaPath("web")}`,
    );
  });
});

describe("areaWrites", () => {
  test("an update rewrites only the areas whose counts changed", () => {
    const before = tree(areaFiles({ [WEB]: 2, [API]: 1 }));
    expect(areaWrites(baseline({ [WEB]: 1, [API]: 1 }), before)).toEqual([
      [areaPath("web"), serializeBaseline(baseline({ [WEB]: 1 }))],
    ]);
    expect(areaWrites(baseline({ [WEB]: 2, [API]: 1 }), before)).toEqual([]);
  });

  test("an update writes every area when none exist yet", () => {
    expect(areaWrites(baseline({}), tree({})).map(([path]) => path)).toEqual(AREAS.map(areaPath));
  });
});

describe("base baseline", () => {
  test("a base with only the legacy single file is still the allowance", () => {
    const legacy = tree({
      ...CHECKER,
      [LEGACY_BASELINE_PATH]: serializeBaseline(baseline({ [WEB]: 2 })),
    });
    expect(run({ [WEB]: 2 }, legacy)).toEqual([]);
    expect(run({ [WEB]: 3 }, legacy)).toEqual([
      `added: ${WEB}: 3 comments (base allows 2)`,
      `baseline raised: ${WEB}: 3 comments (base has 2)`,
    ]);
  });

  test("area files win over a legacy file left in the base", () => {
    const base = tree({
      ...CHECKER,
      ...areaFiles({ [WEB]: 1 }),
      [LEGACY_BASELINE_PATH]: serializeBaseline(baseline({ [WEB]: 5 })),
    });
    expect(run({ [WEB]: 2 }, base)).toContain(`added: ${WEB}: 2 comments (base allows 1)`);
  });

  test("an invalid legacy file is an error", () => {
    const base = tree({ ...CHECKER, [LEGACY_BASELINE_PATH]: "not json" });
    expect(run({}, base)).toEqual([`base ${LEGACY_BASELINE_PATH} is not a valid baseline`]);
  });

  test("a base missing one area file fails instead of allowing nothing or everything", () => {
    const files = areaFiles({ [WEB]: 2 });
    delete files[areaPath("worker")];
    expect(run({ [WEB]: 2 }, tree({ ...CHECKER, ...files }))).toEqual([
      `base ${areaPath("worker")} is missing`,
    ]);
  });
});
