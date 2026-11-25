import { afterAll } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TEMP_PREFIXES, watchedPrefix } from "./temp-prefixes.ts";

export function tempDirs(prefix: string): () => Promise<string> {
  if (!watchedPrefix(prefix))
    throw new Error(
      `tempDirs: ${prefix} doesn't start with a prefix check:test-leaks watches (${TEMP_PREFIXES.join(", ")})`,
    );
  const made: string[] = [];
  afterAll(async () => {
    await Promise.all(made.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });
  return async () => {
    const dir = await mkdtemp(join(tmpdir(), prefix));
    made.push(dir);
    return dir;
  };
}
