import { ORCA_PROFILE_DOCUMENT_NAMES, slicerFormat } from "@conveyor/shared/profile-format";
import {
  type CatalogProfile,
  fetchOrcaProfileContent,
  fetchPrusaProfileContent,
  saveOrcaProfileContent,
  savePrusaProfileContent,
} from "./api.js";
import { resetProfileContent } from "./api-delete.js";
import type { Lang } from "./code-editor.js";

export type Docs = Record<string, string>;

export interface Content {
  files: string[];
  lang: Lang;
  docs: Docs;
  edited: boolean;
  missing: boolean;
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
    const found = await fetchOrcaProfileContent(profile.id, f);
    return {
      files: [...ORCA_PROFILE_DOCUMENT_NAMES],
      lang: "json",
      docs: found ? { ...found.documents } : orcaDocs({}),
      edited: found?.source === "edited",
      missing: !found,
    };
  }
  if (format !== "prusa-ini") return null;
  const found = await fetchPrusaProfileContent(profile.id, f);
  return {
    files: ["config"],
    lang: "ini",
    docs: { config: found?.document.config ?? "" },
    edited: found?.source === "edited",
    missing: !found,
  };
}

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

export interface GateState {
  ready: boolean;
  problem: boolean;
  dirty: boolean;
  busy: boolean;
  tidied: boolean;
}

export const gate = ({ ready, problem, dirty, busy, tidied }: GateState) => ({
  save: ready && !problem && dirty && !busy,
  tidy: ready && tidied,
  reset: ready && !busy,
});
