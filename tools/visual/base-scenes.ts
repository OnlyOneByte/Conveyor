import { join } from "node:path";
import { messageOf } from "./errors.ts";

export interface BaseScene {
  name: string;
  route: string;
}

export type BaseList = { scenes: BaseScene[] } | { reason: string };

export interface BasePlan {
  skips: Map<string, string>;
  notes: string[];
}

const named = (value: unknown): value is { name: string } =>
  typeof value === "object" && value !== null && "name" in value && typeof value.name === "string";

const routeOf = (value: { name: string }): string =>
  "route" in value && typeof value.route === "string" ? value.route : "";

async function loaded(path: string): Promise<{ scenes: unknown } | { reason: string }> {
  try {
    const { scenes } = await import(path);
    return { scenes };
  } catch (err) {
    return { reason: `its scene list failed to load: ${messageOf(err)}` };
  }
}

export async function baseSceneList(root: string): Promise<BaseList> {
  const path = join(root, "tools/visual/scenes.ts");
  if (!(await Bun.file(path).exists())) return { reason: "it has no tools/visual/scenes.ts" };
  const got = await loaded(path);
  if ("reason" in got) return got;
  if (!Array.isArray(got.scenes)) return { reason: "its scenes.ts exports no scenes array" };
  const scenes = got.scenes.filter(named).map((s) => ({ name: s.name, route: routeOf(s) }));
  if (scenes.length === 0) return { reason: "its scene list is empty" };
  return { scenes };
}

export function planBase(list: BaseList, wanted: { name: string }[], known: BaseScene[]): BasePlan {
  if ("reason" in list)
    return {
      skips: new Map(),
      notes: [`the base's scene list can't be used (${list.reason}), so every scene runs on it`],
    };
  const onBase = new Set(list.scenes.map((s) => s.name));
  const inHead = new Set(known.map((s) => s.name));
  const gone = list.scenes.filter((s) => !inHead.has(s.name));
  const skips = new Map<string, string>();
  const notes: string[] = [];
  for (const { name } of wanted.filter((s) => !onBase.has(s.name))) {
    skips.set(name, `not on the base: it has no scene ${name}, so it is new on this PR`);
    const route = known.find((s) => s.name === name)?.route;
    const was = gone.filter((s) => s.route === route).map((s) => s.name);
    if (was.length)
      notes.push(`not compared: ${name} may be the base's ${was.join(" or ")}, renamed`);
  }
  return { skips, notes };
}

export async function skipsOnBase(
  root: string | false,
  wanted: { name: string }[],
  known: BaseScene[],
): Promise<BasePlan> {
  if (root === false) return { skips: new Map(), notes: [] };
  return planBase(await baseSceneList(root), wanted, known);
}

export const notOnBase = (scene: { name: string; ready: string }, ms: number) =>
  `not on the base: "${scene.ready}" didn't appear within ${ms / 1000} s, so ${scene.name} is new on this PR`;
