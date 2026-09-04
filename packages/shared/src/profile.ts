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

// ─── Prusa INI editable profile ──────────────────────────────────────────────

/**
 * A Prusa profile bundle is edited as a single `config.ini` document. Kept as raw
 * text (not a parsed map) for the same reason as Orca: this is a raw editor, so key
 * order and comments survive a save/reload cycle. The API validates before storing;
 * the worker writes the validated text verbatim to a per-job `config.ini`.
 */
export interface PrusaProfileDocument {
  config: string;
}

export const PRUSA_PROFILE_DOCUMENT_NAME = "config" as const;
/** PrusaSlicer configs run larger than Orca leaves (full printer+filament+print). */
export const MAX_PRUSA_DOCUMENT_BYTES = 512 * 1024;

export class PrusaProfileValidationError extends Error {}

/**
 * Shared trust-boundary validation for a Prusa `config.ini` (SAX-04/SAX-10): the API
 * runs it before persistence and the worker runs it again before writing the file, so
 * a direct DB edit cannot bypass the invariant. Text is never normalized — the exact
 * validated bytes are stored and materialized.
 *
 * INI is a permissive format, so the checks are structural rather than a full parse:
 * bounded size, no NUL/control bytes (rejects binary and log/CRLF-injection tricks),
 * and at least one `key = value` line so an empty or junk blob is refused. PrusaSlicer
 * itself is the ultimate arbiter of semantic validity — a parseable-but-wrong config
 * only surfaces when a job actually slices, exactly as for Orca.
 */
export function validatePrusaProfileContent(document: PrusaProfileDocument): void {
  const text = document.config;
  const bytes = new TextEncoder().encode(text).byteLength;
  if (bytes > MAX_PRUSA_DOCUMENT_BYTES) {
    throw new PrusaProfileValidationError("config.ini exceeds the 512 KiB limit");
  }
  // Reject NUL and C0 control bytes other than tab/newline/carriage-return. This
  // blocks binary blobs and control-character injection while leaving normal INI
  // (which is ASCII/UTF-8 text with comments and CRLF or LF line endings) untouched.
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) {
    throw new PrusaProfileValidationError("config.ini contains control characters");
  }
  // Structural floor: at least one `key = value` assignment on a non-comment line.
  // (PrusaSlicer configs are flat key=value; section headers are optional.)
  const hasAssignment = text
    .split(/\r?\n/)
    .some((line) => {
      const t = line.trim();
      if (!t || t.startsWith("#") || t.startsWith(";") || t.startsWith("[")) return false;
      const eq = t.indexOf("=");
      return eq > 0; // a key before the '='
    });
  if (!hasAssignment) {
    throw new PrusaProfileValidationError("config.ini has no key = value settings");
  }
}

// ─── Format routing ──────────────────────────────────────────────────────────

/** The editable-content format a slicer's profiles use. */
export type SlicerProfileFormat = "orca-json" | "prusa-ini";

/**
 * Which editable format a slicer's profiles use — the single source of truth shared
 * by the API (route dispatch), the worker (materialization), and the web client (which
 * editor to open). A slicer with no editable format returns `null` (read-only in the
 * editor). Add a slicer's format here to make its profiles editable everywhere at once.
 */
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
