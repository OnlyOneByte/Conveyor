import type { Station } from "@conveyor/shared";
import type { Profile } from "@conveyor/shared/db";

/**
 * The public, end-user view of a Station. Unlike the raw {@link Station} (which
 * carries slicer/printer wiring), this is the capability-only summary the PWA's
 * station picker renders — enough to show real chips without leaking config.
 *
 * `gcodeFlavor`/`slicerId` are genuine structured fields (station + bound
 * profile). `material`/`quality` are not first-class columns anywhere yet, so
 * they are derived ONCE here from the canonical profile name (e.g.
 * "Klipper PLA 0.2mm (Prusa)") — server-side, from the bound profile, NOT from
 * the arbitrary station display name. Centralizing the parse means a renamed
 * station can never silently break the chips. When material/quality become real
 * profile columns, only this function changes.
 */
export interface StationSummary {
  id: string;
  name: string;
  slicerId: string;
  /** "klipper" | "marlin" | … — from the bound profile, drives transport-compat chips */
  gcodeFlavor?: string;
  /** "PLA" | "PETG" | "ABS" | "TPU" — parsed from the bound profile name */
  material?: string;
  /** "0.2mm" — layer height, parsed from the bound profile name */
  quality?: string;
  allowedGenerators?: string[];
}

const MATERIALS = ["PLA", "PETG", "ABS", "TPU", "ASA", "NYLON", "PC"] as const;

/** Pull a material token out of a canonical profile name, if present. */
function parseMaterial(profileName: string): string | undefined {
  const upper = profileName.toUpperCase();
  // Word-boundary match so "PLApple" can't false-positive; longest-first so
  // "PETG" wins over a hypothetical "PET".
  for (const m of [...MATERIALS].sort((a, b) => b.length - a.length)) {
    if (new RegExp(`\\b${m}\\b`).test(upper)) return m;
  }
  return undefined;
}

/** Pull a layer-height/quality token (e.g. "0.2mm") out of a profile name. */
function parseQuality(profileName: string): string | undefined {
  const m = profileName.match(/(\d+\.\d+)\s*mm/i);
  return m ? `${m[1]}mm` : undefined;
}

/**
 * Build the public summary for a station, joined with its bound profile.
 * `profile` may be undefined (a dangling profileId) — the summary still returns
 * the structured station fields it does know.
 */
export function toStationSummary(station: Station, profile: Profile | undefined): StationSummary {
  return {
    id: station.id,
    name: station.name,
    slicerId: station.slicerId,
    gcodeFlavor: profile?.gcodeFlavor,
    material: profile ? parseMaterial(profile.name) : undefined,
    quality: profile ? parseQuality(profile.name) : undefined,
    allowedGenerators: station.allowedGenerators,
  };
}
