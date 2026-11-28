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

function ownNames(names: string[], skip: ReadonlySet<string>): string[] {
  return names.filter((name) => !skip.has(name) && OWN_FILE.test(name));
}

export async function folderBytes(
  dir: string,
  skip: ReadonlySet<string> = new Set(),
): Promise<number> {
  const names = await readdir(dir).catch((error: unknown) => {
    if (missing(error)) return [];
    throw error;
  });
  const sizes = await Promise.all(ownNames(names, skip).map((n) => sizeOf(join(dir, n))));
  return sizes.reduce((total, size) => total + size, 0);
}

export const DEFAULT_RESCAN_MS = 60_000;

export interface Reservation {
  full(): boolean;
  take(bytes: number): void;
  commit(bytes: number): void;
  release(): void;
}

export interface FolderBudget {
  start(part: string): Promise<Reservation>;
}

export async function folderBudget(
  dir: string,
  cap: number,
  rescanMs = DEFAULT_RESCAN_MS,
  now: () => number = Date.now,
): Promise<FolderBudget> {
  let stored = 0;
  let inFlight = 0;
  let scannedAt = Number.NEGATIVE_INFINITY;
  let committedDuringScan = 0;
  let scanning: Promise<void> | undefined;
  const parts = new Set<string>();
  const rescan = (): Promise<void> => {
    scanning ??= (async () => {
      committedDuringScan = 0;
      const found = await folderBytes(dir, parts);
      stored = found + committedDuringScan;
      scannedAt = now();
    })().finally(() => {
      scanning = undefined;
    });
    return scanning;
  };
  await rescan();
  return {
    async start(part) {
      if (scanning || now() - scannedAt >= rescanMs) await rescan();
      const name = basename(part);
      parts.add(name);
      let held = 0;
      const release = () => {
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
          if (scanning) committedDuringScan += bytes;
        },
        release,
      };
    },
  };
}
