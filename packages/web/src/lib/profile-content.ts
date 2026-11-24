import { ORCA_PROFILE_DOCUMENT_NAMES, slicerFormat } from "@conveyor/shared";
import {
  type CatalogProfile,
  fetchOrcaProfileContent,
  fetchPrusaProfileContent,
  resetProfileContent,
  saveOrcaProfileContent,
  savePrusaProfileContent,
} from "./api.js";
import type { Lang } from "./code-editor.js";
import { orcaProblem, type Problem, prusaProblem } from "./profile-check.js";

export type Docs = Record<string, string>;

export interface Content {
  files: string[];
  lang: Lang;
  docs: Docs;
  edited: boolean;
}

const orcaDocs = (docs: Docs) => ({
  machine: docs.machine ?? "",
  process: docs.process ?? "",
  filament: docs.filament ?? "",
});

export async function loadContent(
  profile: CatalogProfile,
  f: typeof fetch = fetch,
): Promise<Content | null> {
  const format = slicerFormat(profile.slicerId);
  if (format === "orca-json") {
    const { documents, source } = await fetchOrcaProfileContent(profile.id, f);
    return {
      files: [...ORCA_PROFILE_DOCUMENT_NAMES],
      lang: "json",
      docs: { ...documents },
      edited: source === "edited",
    };
  }
  if (format !== "prusa-ini") return null;
  const { document, source } = await fetchPrusaProfileContent(profile.id, f);
  return {
    files: ["config"],
    lang: "ini",
    docs: { config: document.config },
    edited: source === "edited",
  };
}

export const problemOf = (lang: Lang, docs: Docs): Problem | null =>
  lang === "json" ? orcaProblem(orcaDocs(docs)) : prusaProblem(docs.config ?? "");

export const saveContent = (profile: CatalogProfile, lang: Lang, docs: Docs) =>
  lang === "json"
    ? saveOrcaProfileContent(profile.id, orcaDocs(docs))
    : savePrusaProfileContent(profile.id, { config: docs.config ?? "" });

export const resetContent = (profile: CatalogProfile) => resetProfileContent(profile.id);

export const changed = (docs: Docs, saved: Docs) =>
  Object.keys(saved).some((file) => docs[file] !== saved[file]);

export function formatted(text: string): string | null {
  try {
    return `${JSON.stringify(JSON.parse(text), null, 2)}\n`;
  } catch {
    return null;
  }
}

export function status(invalid: boolean, busy: boolean, dirty: boolean): string {
  if (invalid) return "Fix the error to save";
  if (busy) return "Saving…";
  return dirty ? "Unsaved changes" : "No changes yet";
}
