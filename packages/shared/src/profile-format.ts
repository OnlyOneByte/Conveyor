export const ORCA_PROFILE_DOCUMENT_NAMES = ["machine", "process", "filament"] as const;
export type OrcaProfileDocumentName = (typeof ORCA_PROFILE_DOCUMENT_NAMES)[number];

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
