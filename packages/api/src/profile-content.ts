import type { Database } from "bun:sqlite";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isBundledProfilePath,
  MAX_ORCA_DOCUMENT_BYTES,
  MAX_PRUSA_DOCUMENT_BYTES,
  ORCA_PROFILE_DOCUMENT_NAMES,
  type OrcaProfileDocumentName,
  type OrcaProfileDocuments,
  OrcaProfileValidationError,
  orcaPrintVolume,
  type PrintVolume,
  type PrusaProfileDocument,
  PrusaProfileValidationError,
  prusaPrintVolume,
  slicerFormat,
  validateOrcaProfileDocuments,
  validatePrusaProfileContent,
} from "@conveyor/shared";
import {
  dbGetOrcaProfileDocuments,
  dbGetPrusaProfileContent,
  type Profile,
} from "@conveyor/shared/db";
import { isWithin } from "@conveyor/shared/node";

const defaultProfilesRoot = fileURLToPath(new URL("../../../profiles", import.meta.url));
const profilesRoot = (): string =>
  resolve(process.env.CONVEYOR_PROFILES_ROOT ?? defaultProfilesRoot);
const LOGICAL_PREFIX = "/profiles/";

export class ProfileContentError extends Error {
  constructor(
    message: string,
    readonly statusCode: 400 | 404 | 409 = 400,
  ) {
    super(message);
  }
}

async function bundledDirectory(logicalPath: string): Promise<{ root: string; directory: string }> {
  if (!logicalPath.startsWith(LOGICAL_PREFIX)) {
    throw new ProfileContentError("profile does not reference a bundled /profiles path", 409);
  }
  if (!isBundledProfilePath(logicalPath)) {
    throw new ProfileContentError("profile has an invalid bundled path", 409);
  }
  const suffix = logicalPath.slice(LOGICAL_PREFIX.length);

  try {
    const root = await realpath(profilesRoot());
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

export async function profileVolume(db: Database, profile: Profile): Promise<PrintVolume | null> {
  try {
    switch (slicerFormat(profile.slicerId)) {
      case "orca-json": {
        const documents =
          dbGetOrcaProfileDocuments(db, profile.id) ??
          (await readBundledOrcaDocuments(profile.path));
        return orcaPrintVolume(documents.machine);
      }
      case "prusa-ini": {
        const document =
          dbGetPrusaProfileContent(db, profile.id) ?? (await readBundledPrusaConfig(profile.path));
        return prusaPrintVolume(document.config);
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}
