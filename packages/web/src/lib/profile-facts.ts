import { isBundledProfilePath } from "@conveyor/shared/profile-format";
import type { CatalogProfile, CatalogSlicer } from "./api.js";
import { slugOf } from "./printer-form.js";

const MATERIALS = ["PLA", "PETG", "ABS", "ASA", "TPU", "PA", "PC", "HIPS", "PVA", "Nylon"];
const MATERIAL = new RegExp(`\\b(${MATERIALS.join("|")})\\b`, "i");
const FIRMWARE: Record<string, string> = { klipper: "Klipper", marlin: "Marlin", reprap: "RepRap" };

export const firmwareName = (flavor: string) => FIRMWARE[flavor] ?? flavor;

export function profileFacts(profile: CatalogProfile, slicers: CatalogSlicer[]): string {
  const hit = profile.name.match(MATERIAL)?.[1]?.toLowerCase();
  const material = MATERIALS.find((name) => name.toLowerCase() === hit);
  const layer = profile.name.match(/(\d+(?:\.\d+)?)\s*mm/i)?.[1];
  const slicer = slicers.find((s) => s.id === profile.slicerId)?.name ?? profile.slicerId;
  const height = layer && `${Number(layer).toFixed(2)} mm`;
  return [material, height, firmwareName(profile.gcodeFlavor), slicer].filter(Boolean).join(" · ");
}

export function profileTag({ bundled, hasEditableContent }: CatalogProfile): string {
  const origin = bundled ? "Bundled" : "Added";
  return hasEditableContent ? `${origin}, edited` : origin;
}

export interface ProfileDraft {
  name: string;
  slicerId: string;
  gcodeFlavor: string;
  path: string;
}

export type ProfileErrors = Partial<Record<keyof ProfileDraft, string>>;

const profileId = ({ slicerId, name }: ProfileDraft) => `${slicerId}/${slugOf(name)}`;

export const folderOf = (name: string) => `/profiles/${slugOf(name)}`;

export function profileErrors(draft: ProfileDraft, taken: string[]): ProfileErrors {
  const errors: ProfileErrors = {};
  if (!slugOf(draft.name)) errors.name = "Give the profile a name.";
  else if (taken.includes(profileId(draft))) errors.name = "Another profile already has this name.";
  if (!isBundledProfilePath(draft.path.trim()))
    errors.path = "Use a folder under /profiles, like /profiles/voron-petg.";
  return errors;
}

export const profilePayload = (draft: ProfileDraft): CatalogProfile => ({
  id: profileId(draft),
  name: draft.name.trim(),
  slicerId: draft.slicerId,
  gcodeFlavor: draft.gcodeFlavor,
  path: draft.path.trim(),
});
