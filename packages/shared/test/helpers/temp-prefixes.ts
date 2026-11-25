export const TEMP_PREFIXES: readonly string[] = [
  "conveyor-",
  "colours-",
  "pr-meta-",
  "gridfinity-smoke-",
  "orca-smoke-",
  "vis-",
  "visual-",
];

export const watchedPrefix = (name: string): boolean =>
  TEMP_PREFIXES.some((prefix) => name.startsWith(prefix));
