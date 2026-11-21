import { ORCA_CONFIG_KEYS, PRUSA_CONFIG_KEYS } from "./slicer-keys.js";

export interface OrcaProfileDocuments {
  machine: string;
  process: string;
  filament: string;
}

export const ORCA_PROFILE_DOCUMENT_NAMES = ["machine", "process", "filament"] as const;
export type OrcaProfileDocumentName = (typeof ORCA_PROFILE_DOCUMENT_NAMES)[number];

export const MAX_ORCA_DOCUMENT_BYTES = 256 * 1024;
export const MAX_ORCA_CONTENT_BYTES = MAX_ORCA_DOCUMENT_BYTES * 3;

export class OrcaProfileValidationError extends Error {}

export function validateOrcaProfileDocuments(documents: OrcaProfileDocuments): void {
  const encoder = new TextEncoder();
  let total = 0;
  for (const name of ORCA_PROFILE_DOCUMENT_NAMES) {
    const text = documents[name];
    const bytes = encoder.encode(text).byteLength;
    total += bytes;
    if (bytes > MAX_ORCA_DOCUMENT_BYTES) {
      throw new OrcaProfileValidationError(`${name}.json exceeds the 256 KiB limit`);
    }

    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch (error) {
      const detail = error instanceof SyntaxError ? error.message : "invalid JSON";
      throw new OrcaProfileValidationError(`${name}.json: ${detail}`);
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new OrcaProfileValidationError(`${name}.json must contain a JSON object`);
    }
    const declaredType = (value as Record<string, unknown>).type;
    if (declaredType !== undefined && declaredType !== name) {
      throw new OrcaProfileValidationError(
        `${name}.json has type ${JSON.stringify(declaredType)}; expected ${JSON.stringify(name)}`,
      );
    }
    for (const key of Object.keys(value)) {
      if (!ORCA_CONFIG_KEYS.has(key)) {
        throw new OrcaProfileValidationError(
          `${name}.json: setting ${JSON.stringify(key)} is not permitted`,
        );
      }
    }
  }
  if (total > MAX_ORCA_CONTENT_BYTES) {
    throw new OrcaProfileValidationError("combined Orca profile content exceeds the 768 KiB limit");
  }
}

export interface OrcaEditableProfile {
  format: "orca-json";
  documents: OrcaProfileDocuments;
}

export interface PrusaProfileDocument {
  config: string;
}

export const PRUSA_PROFILE_DOCUMENT_NAME = "config" as const;
export const MAX_PRUSA_DOCUMENT_BYTES = 512 * 1024;

export class PrusaProfileValidationError extends Error {}

const ALLOWED_CONTROL_CHARS = new Set([0x09, 0x0a, 0x0d]);

function hasDisallowedControlChar(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x20 && !ALLOWED_CONTROL_CHARS.has(code)) return true;
  }
  return false;
}

export function validatePrusaProfileContent(document: PrusaProfileDocument): void {
  const text = document.config;
  const bytes = new TextEncoder().encode(text).byteLength;
  if (bytes > MAX_PRUSA_DOCUMENT_BYTES) {
    throw new PrusaProfileValidationError("config.ini exceeds the 512 KiB limit");
  }
  if (hasDisallowedControlChar(text)) {
    throw new PrusaProfileValidationError("config.ini contains control characters");
  }
  let assignments = 0;
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";") || trimmed.startsWith("["))
      continue;
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex <= 0) {
      throw new PrusaProfileValidationError(
        `config.ini line ${index + 1} is not a key = value setting`,
      );
    }
    const key = trimmed.slice(0, equalsIndex).trim();
    if (!PRUSA_CONFIG_KEYS.has(key)) {
      throw new PrusaProfileValidationError(
        `config.ini: setting ${JSON.stringify(key)} is not permitted`,
      );
    }
    assignments++;
  }
  if (assignments === 0) {
    throw new PrusaProfileValidationError("config.ini has no key = value settings");
  }
}

export function isBundledProfilePath(path: string): boolean {
  return /^\/profiles\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(path) && !path.includes("..");
}

export type SlicerProfileFormat = "orca-json" | "prusa-ini";

export function slicerFormat(slicerId: string): SlicerProfileFormat | null {
  switch (slicerId) {
    case "orca":
      return "orca-json";
    case "prusa":
      return "prusa-ini";
    default:
      return null;
  }
}
