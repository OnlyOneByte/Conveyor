import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ORCA_PROFILE_DOCUMENT_NAMES,
  type OrcaProfileDocumentName,
  type OrcaProfileDocuments,
} from "@conveyor/shared";

/** Generous relative to the shipped bundle (~14 KiB total), bounded against DoS. */
export const MAX_ORCA_DOCUMENT_BYTES = 256 * 1024;
export const MAX_ORCA_CONTENT_BYTES = MAX_ORCA_DOCUMENT_BYTES * 3;

/**
 * Logical profile paths in SQLite remain `/profiles/<bundle>` in every environment.
 * The actual readable root is injected in containers and defaults to the repository's
 * profiles/ directory in local development.
 */
const defaultProfilesRoot = fileURLToPath(new URL("../../../profiles", import.meta.url));
const profilesRoot = resolve(process.env.CONVEYOR_PROFILES_ROOT ?? defaultProfilesRoot);
const LOGICAL_PREFIX = "/profiles/";

export class ProfileContentError extends Error {
  constructor(
    message: string,
    readonly statusCode: 400 | 404 | 409 = 400,
  ) {
    super(message);
  }
}

function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

/**
 * Map a logical DB path to a canonical directory beneath the configured, server-owned
 * profile root. The request never supplies a filename: the only filenames opened are
 * the three constants below. realpath checks also contain symlinks.
 */
async function bundledDirectory(logicalPath: string): Promise<{ root: string; directory: string }> {
  if (!logicalPath.startsWith(LOGICAL_PREFIX)) {
    throw new ProfileContentError("profile does not reference a bundled /profiles path", 409);
  }
  const suffix = logicalPath.slice(LOGICAL_PREFIX.length);
  const segments = suffix.split("/");
  // Allowlist profile-directory characters rather than trying to enumerate traversal
  // encodings. Existing bundles use lowercase letters, digits, dashes and dots.
  if (
    !suffix ||
    segments.some((segment) => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segment))
  ) {
    throw new ProfileContentError("profile has an invalid bundled path", 409);
  }

  try {
    const root = await realpath(profilesRoot);
    const directory = await realpath(resolve(root, suffix));
    if (!isWithin(root, directory)) {
      throw new ProfileContentError("profile path escapes the bundled profile root", 409);
    }
    return { root, directory };
  } catch (error) {
    if (error instanceof ProfileContentError) throw error;
    throw new ProfileContentError("bundled profile directory is unavailable", 404);
  }
}

async function readBoundedDocument(
  root: string,
  directory: string,
  name: OrcaProfileDocumentName,
): Promise<string> {
  try {
    const file = await realpath(join(directory, `${name}.json`));
    if (!isWithin(root, file)) {
      throw new ProfileContentError(`${name}.json escapes the bundled profile root`, 409);
    }
    const info = await stat(file);
    if (!info.isFile()) throw new ProfileContentError(`${name}.json is not a file`, 409);
    if (info.size > MAX_ORCA_DOCUMENT_BYTES) {
      throw new ProfileContentError(`${name}.json exceeds the 256 KiB limit`);
    }
    const text = await readFile(file, "utf8");
    if (Buffer.byteLength(text, "utf8") > MAX_ORCA_DOCUMENT_BYTES) {
      throw new ProfileContentError(`${name}.json exceeds the 256 KiB limit`);
    }
    return text;
  } catch (error) {
    if (error instanceof ProfileContentError) throw error;
    throw new ProfileContentError(`bundled ${name}.json is unavailable`, 404);
  }
}

export async function readBundledOrcaDocuments(path: string): Promise<OrcaProfileDocuments> {
  const { root, directory } = await bundledDirectory(path);
  const [machine, process, filament] = await Promise.all(
    ORCA_PROFILE_DOCUMENT_NAMES.map((name) => readBoundedDocument(root, directory, name)),
  );
  return { machine, process, filament };
}

/**
 * Parse and structurally validate every document. Content is deliberately not
 * sanitized or rewritten: validated text is persisted verbatim for the raw editor.
 */
export function validateOrcaDocuments(documents: OrcaProfileDocuments): void {
  let total = 0;
  for (const name of ORCA_PROFILE_DOCUMENT_NAMES) {
    const text = documents[name];
    const bytes = Buffer.byteLength(text, "utf8");
    total += bytes;
    if (bytes > MAX_ORCA_DOCUMENT_BYTES) {
      throw new ProfileContentError(`${name}.json exceeds the 256 KiB limit`);
    }

    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch (error) {
      const detail = error instanceof SyntaxError ? error.message : "invalid JSON";
      throw new ProfileContentError(`${name}.json: ${detail}`);
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new ProfileContentError(`${name}.json must contain a JSON object`);
    }
    const declaredType = (value as Record<string, unknown>).type;
    if (declaredType !== undefined && declaredType !== name) {
      throw new ProfileContentError(
        `${name}.json has type ${JSON.stringify(declaredType)}; expected ${JSON.stringify(name)}`,
      );
    }
  }
  if (total > MAX_ORCA_CONTENT_BYTES) {
    throw new ProfileContentError("combined Orca profile content exceeds the 768 KiB limit");
  }
}
