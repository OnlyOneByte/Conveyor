import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MAX_ORCA_DOCUMENT_BYTES,
  MAX_PRUSA_DOCUMENT_BYTES,
  ORCA_PROFILE_DOCUMENT_NAMES,
  OrcaProfileValidationError,
  PrusaProfileValidationError,
  validateOrcaProfileDocuments,
  validatePrusaProfileContent,
  type OrcaProfileDocumentName,
  type OrcaProfileDocuments,
  type PrusaProfileDocument,
} from "@conveyor/shared";

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

/** Translate shared validation errors into this API surface's typed 400 error. */
export function validateOrcaDocuments(documents: OrcaProfileDocuments): void {
  try {
    validateOrcaProfileDocuments(documents);
  } catch (error) {
    if (error instanceof OrcaProfileValidationError) {
      throw new ProfileContentError(error.message);
    }
    throw error;
  }
}

// ─── Prusa config.ini (bundled read + validation) ────────────────────────────

/**
 * Read the bundled Prusa `config.ini` for editing. Prefers `config.ini`; otherwise
 * the first `.ini` alphabetically — matching the slicer adapter's `loadConfigs`
 * preference, but surfaced as ONE editable document (a multi-`.ini` split stays a
 * bundled-only detail). The directory is canonicalized + containment-checked exactly
 * like the Orca reader, and only a `.ini` filename discovered by listing the trusted
 * bundle dir is opened — no request-supplied filename ever reaches the filesystem.
 */
export async function readBundledPrusaConfig(path: string): Promise<PrusaProfileDocument> {
  const { root, directory } = await bundledDirectory(path);
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    throw new ProfileContentError("bundled Prusa profile directory is unavailable", 404);
  }
  const inis = entries.filter((f) => f.toLowerCase().endsWith(".ini")).sort();
  const chosen = inis.includes("config.ini") ? "config.ini" : inis[0];
  if (!chosen) throw new ProfileContentError("bundled Prusa profile has no .ini config", 404);

  try {
    const file = await realpath(join(directory, chosen));
    if (!isWithin(root, file)) {
      throw new ProfileContentError("Prusa config escapes the bundled profile root", 409);
    }
    const info = await stat(file);
    if (!info.isFile()) throw new ProfileContentError("bundled Prusa config is not a file", 409);
    if (info.size > MAX_PRUSA_DOCUMENT_BYTES) {
      throw new ProfileContentError("bundled config.ini exceeds the 512 KiB limit");
    }
    const text = await readFile(file, "utf8");
    if (Buffer.byteLength(text, "utf8") > MAX_PRUSA_DOCUMENT_BYTES) {
      throw new ProfileContentError("bundled config.ini exceeds the 512 KiB limit");
    }
    return { config: text };
  } catch (error) {
    if (error instanceof ProfileContentError) throw error;
    throw new ProfileContentError("bundled Prusa config is unavailable", 404);
  }
}

/** Translate the shared Prusa validation error into this surface's typed 400. */
export function validatePrusaContent(document: PrusaProfileDocument): void {
  try {
    validatePrusaProfileContent(document);
  } catch (error) {
    if (error instanceof PrusaProfileValidationError) {
      throw new ProfileContentError(error.message);
    }
    throw error;
  }
}
