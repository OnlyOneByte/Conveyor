import { join } from "node:path";

const named = (value: unknown): value is { name: string } =>
  typeof value === "object" && value !== null && "name" in value && typeof value.name === "string";

export async function sceneNamesAt(root: string): Promise<Set<string> | null> {
  const path = join(root, "tools/visual/scenes.ts");
  if (!(await Bun.file(path).exists())) return null;
  const { scenes } = await import(path).catch(() => ({ scenes: null }));
  if (!Array.isArray(scenes)) return null;
  return new Set(scenes.filter(named).map((scene) => scene.name));
}

export const missingFrom = (names: Set<string> | null, wanted: string[]): string[] =>
  names ? wanted.filter((name) => !names.has(name)) : [];

export async function skipsOnBase(
  root: string | null,
  wanted: { name: string }[],
): Promise<Map<string, string>> {
  const names = root === null ? null : await sceneNamesAt(root);
  const missing = missingFrom(
    names,
    wanted.map((scene) => scene.name),
  );
  return new Map(
    missing.map((name) => [
      name,
      `not on the base: it has no scene ${name}, so it is new on this PR`,
    ]),
  );
}
