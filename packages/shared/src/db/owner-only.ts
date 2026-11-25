import { chmodSync, closeSync, existsSync, mkdirSync, openSync, statSync } from "node:fs";
import { dirname } from "node:path";

const DB_FILES = ["", "-wal", "-shm"];

export function ownerOnlyDbFiles(path: string): void {
  if (path === ":memory:") return;
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    closeSync(openSync(path, "a", 0o600));
    return;
  }
  for (const file of DB_FILES.map((suffix) => `${path}${suffix}`)) {
    if (!existsSync(file)) continue;
    const { mode, uid } = statSync(file);
    if ((mode & 0o077) !== 0 && uid === process.getuid?.()) chmodSync(file, 0o600);
  }
}
