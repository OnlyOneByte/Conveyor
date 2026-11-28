import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

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

export async function folderBytes(dir: string, except = ""): Promise<number> {
  const names = await readdir(dir).catch((error: unknown) => {
    if (missing(error)) return [];
    throw error;
  });
  const own = names.filter((name) => name !== except && OWN_FILE.test(name));
  const sizes = await Promise.all(own.map((name) => sizeOf(join(dir, name))));
  return sizes.reduce((total, size) => total + size, 0);
}
