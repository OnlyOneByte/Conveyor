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

/**
 * Editable content is format-tagged so Prusa INI or another slicer's profile format
 * can be added later without weakening the Orca contract.
 */
export interface OrcaEditableProfile {
  format: "orca-json";
  documents: OrcaProfileDocuments;
}
