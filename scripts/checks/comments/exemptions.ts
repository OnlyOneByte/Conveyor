import type { Range } from "./cursor";

export interface Exemption {
  name: string;
  where: string;
  pattern: RegExp;
}

export const EXEMPTIONS: readonly Exemption[] = [
  {
    name: "shebang",
    where: "#! and the interpreter path at the very start of a script or shell file",
    pattern: /#!\S*/y,
  },
];

const extent = (pattern: RegExp, range: Range) => {
  pattern.lastIndex = range.from;
  return pattern.exec(range.src)?.[0].length ?? 0;
};

export const scanStart = (range: Range) =>
  range.from + Math.max(0, ...EXEMPTIONS.map((e) => extent(e.pattern, range)));
