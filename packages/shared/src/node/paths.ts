import { isAbsolute, relative, sep } from "node:path";

export function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return !rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel);
}
