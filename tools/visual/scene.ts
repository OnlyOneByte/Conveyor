import type { Step } from "./step.ts";

export type { Step } from "./step.ts";

export const WIDTHS = [1440, 390] as const;

export const HEIGHTS: Record<number, number> = { 1440: 900, 390: 844 };

export interface Scene {
  name: string;
  route: string;
  ready: string;
  steps?: Step[];
  record?: boolean;
  fullPage?: boolean;
  signedOut?: boolean;
  reducedMotion?: boolean;
  widths?: readonly (typeof WIDTHS)[number][];
  height?: number;
  visits?: string[];
}

export const keys = (...presses: string[]): Step[] =>
  presses.flatMap((press) => [{ press }, { wait: 400 }]);
