import { indexIn, type Range } from "./cursor";

export interface Exemption {
  name: string;
  where: string;
  matches: (src: string, from: number) => boolean;
}

export const EXEMPTIONS: readonly Exemption[] = [
  {
    name: "shebang",
    where: "a #! line at the very start of a script or shell file",
    matches: (src, from) => src.startsWith("#!", from),
  },
];

export const scanStart = (range: Range) =>
  EXEMPTIONS.some((e) => e.matches(range.src, range.from)) ? indexIn(range, "\n") : range.from;
