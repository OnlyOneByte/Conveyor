import { readdirSync, statSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";

const OWN_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.stl(\.part)?$/;

export const FOLDER_FULL =
  "the uploads folder is full (CONVEYOR_UPLOADS_MAX_BYTES). Delete old uploads or raise the limit, then try again.";

export class FolderFull extends Error {
  constructor() {
    super(FOLDER_FULL);
    this.name = "FolderFull";
  }
}

const missing = (error: unknown) =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

async function sizeOf(path: string): Promise<number> {
  return stat(path).then(
    (s) => (s.isFile() ? s.size : 0),
    (error: unknown) => {
      if (missing(error)) return 0;
      throw error;
    },
  );
}

function sizeOfSync(path: string): number {
  try {
    const s = statSync(path);
    return s.isFile() ? s.size : 0;
  } catch (error) {
    if (missing(error)) return 0;
    throw error;
  }
}

function ownNames(names: string[], skip: ReadonlySet<string>): string[] {
  return names.filter((name) => !skip.has(name) && OWN_FILE.test(name));
}

export async function folderBytes(dir: string): Promise<number> {
  const names = await readdir(dir).catch((error: unknown) => {
    if (missing(error)) return [];
    throw error;
  });
  const sizes = await Promise.all(ownNames(names, new Set()).map((n) => sizeOf(join(dir, n))));
  return sizes.reduce((total, size) => total + size, 0);
}

function folderBytesSync(dir: string, skip: ReadonlySet<string>): number {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (error) {
    if (missing(error)) return 0;
    throw error;
  }
  return ownNames(names, skip).reduce((total, name) => total + sizeOfSync(join(dir, name)), 0);
}

export interface Reservation {
  full(): boolean;
  take(bytes: number): void;
  commit(bytes: number): void;
  release(): void;
}

export function folderBudget(dir: string, cap: number) {
  let stored = 0;
  let inFlight = 0;
  const parts = new Set<string>();
  return {
    start(part: string): Reservation {
      stored = folderBytesSync(dir, parts);
      const name = basename(part);
      parts.add(name);
      let held = 0;
      let open = true;
      const release = () => {
        if (!open) return;
        open = false;
        inFlight -= held;
        held = 0;
        parts.delete(name);
      };
      return {
        full: () => stored + inFlight >= cap,
        take(bytes) {
          if (stored + inFlight + bytes > cap) throw new FolderFull();
          inFlight += bytes;
          held += bytes;
        },
        commit(bytes) {
          release();
          stored += bytes;
        },
        release,
      };
    },
  };
}
