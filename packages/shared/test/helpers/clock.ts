import { setSystemTime } from "bun:test";

export const FIXED_EPOCH_MS = Date.UTC(2026, 0, 1, 12, 0, 0);

export interface FixedClock {
  now: () => number;
  advance: (ms: number) => number;
  set: (ms: number) => number;
  restore: () => void;
}

export function fixedClock(start = FIXED_EPOCH_MS): FixedClock {
  let current = start;
  const apply = (ms: number) => {
    current = ms;
    setSystemTime(new Date(current));
    return current;
  };
  apply(start);
  return {
    now: () => current,
    advance: (ms) => apply(current + ms),
    set: apply,
    restore: () => {
      setSystemTime();
    },
  };
}
