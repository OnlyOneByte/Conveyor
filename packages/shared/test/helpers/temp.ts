import { afterAll } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function tempDirs(prefix: string): () => Promise<string> {
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
