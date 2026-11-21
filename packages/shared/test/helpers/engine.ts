import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function fakeEngine(dir: string, name: string, body: string): string {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\nprintf '%s\\n' "$@" > "${join(dir, `${name}.args`)}"\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

export function engineArgs(dir: string, name: string): string[] {
  return readFileSync(join(dir, `${name}.args`), "utf8")
    .trimEnd()
    .split("\n");
}

export function setEnv(vars: Record<string, string | undefined>): () => void {
  const previous = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  const apply = (values: Record<string, string | undefined>) => {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  apply(vars);
  return () => apply(previous);
}
