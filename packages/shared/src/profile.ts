/**
 * The three files that make up an editable Orca profile bundle.
 *
 * Values are raw JSON text rather than parsed objects on purpose: this is a raw
 * editor, so whitespace/key order should survive a save/reload cycle. The API parses
 * each document to validate it before persistence; the worker writes the validated
 * text verbatim into a per-job directory before invoking Orca.
 */
export interface OrcaProfileDocuments {
  machine: string;
  process: string;
  filament: string;
}

export const ORCA_PROFILE_DOCUMENT_NAMES = ["machine", "process", "filament"] as const;
export type OrcaProfileDocumentName = (typeof ORCA_PROFILE_DOCUMENT_NAMES)[number];

/** Generous relative to the shipped bundle (~14 KiB total), bounded against DoS. */
export const MAX_ORCA_DOCUMENT_BYTES = 256 * 1024;
export const MAX_ORCA_CONTENT_BYTES = MAX_ORCA_DOCUMENT_BYTES * 3;

export class OrcaProfileValidationError extends Error {}

/**
 * Shared trust-boundary validation. The API runs it before persistence and the worker
 * runs it again before writing files, so direct DB edits cannot bypass the invariant.
 * Text is never normalized: callers store/materialize the exact validated bytes.
 */
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
  }
  if (total > MAX_ORCA_CONTENT_BYTES) {
    throw new OrcaProfileValidationError("combined Orca profile content exceeds the 768 KiB limit");
  }
}

/**
 * Editable content is format-tagged so Prusa INI or another slicer's profile format
 * can be added later without weakening the Orca contract.
 */
export interface OrcaEditableProfile {
  format: "orca-json";
  documents: OrcaProfileDocuments;
}
