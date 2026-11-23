import type { Tree } from "../comments/tree";

export const FILE_LIMIT = 250;

export const COMPONENT_LIMIT = 150;

const IN_SCOPE = /\.(ts|tsx|mts|cts|js|mjs|cjs|jsx|svelte|css)$/;

export type Counts = Record<string, number>;

export const inScope = (path: string) => IN_SCOPE.test(path);

export const limitOf = (path: string) => (path.endsWith(".svelte") ? COMPONENT_LIMIT : FILE_LIMIT);

export function countLines(text: string): number {
  if (text === "") return 0;
  const breaks = text.split("\n").length - 1;
  return text.endsWith("\n") ? breaks : breaks + 1;
}

export function measure(tree: Tree): Counts {
  const counts: Counts = {};
  for (const path of tree.list().sort()) {
    const text = inScope(path) ? tree.read(path) : null;
    if (text !== null) counts[path] = countLines(text);
  }
  return counts;
}

export const overLimit = (counts: Counts): Counts =>
  Object.fromEntries(Object.entries(counts).filter(([path, lines]) => lines > limitOf(path)));
