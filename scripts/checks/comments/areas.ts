import { type Baseline, parseBaseline, serializeBaseline } from "./baseline";
import type { Tree } from "./tree";

export const AREAS = ["api", "worker", "shared", "web", "plugins", "repo"] as const;

export type Area = (typeof AREAS)[number];

const PACKAGE_AREAS: readonly Area[] = ["api", "worker", "shared", "web"];

export const BASELINE_DIR = "scripts/checks/comments/baseline";

export const areaPath = (area: string) => `${BASELINE_DIR}/${area}.json`;

export function areaOf(path: string): Area {
  if (path.startsWith("plugins/")) return "plugins";
  const name = /^packages\/([^/]+)\//.exec(path)?.[1];
  return PACKAGE_AREAS.find((area) => area === name) ?? "repo";
}

export type AreaTexts = Record<string, string | null>;

export const readAreas = (tree: Tree): AreaTexts =>
  Object.fromEntries(AREAS.map((area) => [area, tree.read(areaPath(area))]));

const misplaced = (area: Area, baseline: Baseline) =>
  Object.keys(baseline.files).find((file) => areaOf(file) !== area);

function parseArea(area: Area, text: string | null): Baseline | string {
  if (text === null) return `${areaPath(area)} is missing`;
  const baseline = parseBaseline(text);
  if (baseline === null) return `${areaPath(area)} is not a valid baseline`;
  const stray = misplaced(area, baseline);
  if (stray !== undefined) {
    return `${areaPath(area)} lists ${stray}, which belongs in ${areaPath(areaOf(stray))}`;
  }
  return baseline;
}

export function parseAreas(texts: AreaTexts): Baseline | string | null {
  if (AREAS.every((area) => (texts[area] ?? null) === null)) return null;
  const files: Baseline["files"] = {};
  for (const area of AREAS) {
    const parsed = parseArea(area, texts[area] ?? null);
    if (typeof parsed === "string") return parsed;
    Object.assign(files, parsed.files);
  }
  return { files };
}

export function serializeAreas(baseline: Baseline): [string, string][] {
  return AREAS.map((area) => {
    const files = Object.fromEntries(
      Object.entries(baseline.files).filter(([file]) => areaOf(file) === area),
    );
    return [areaPath(area), serializeBaseline({ files })];
  });
}

export const areaWrites = (baseline: Baseline, tree: Tree): [string, string][] =>
  serializeAreas(baseline).filter(([path, text]) => tree.read(path) !== text);
