import type { Station } from "@conveyor/shared";

/**
 * M0 stub mirroring the API seed. M2+: both api and worker read the same
 * SQLite store (docs/DATA-MODEL.md) so there is one source of truth.
 */
const SEED: Record<string, Station> = {
  "garage-klipper-pla": {
    id: "garage-klipper-pla",
    name: "Garage Klipper — PLA 0.2mm",
    transportId: "moonraker",
    printerId: "klipper-garage",
    slicerId: "orca",
    profileId: "orca/klipper-pla-0.2",
  },
  "elegoo-pla": {
    id: "elegoo-pla",
    name: "Elegoo — PLA 0.2mm",
    transportId: "elegoo",
    printerId: "elegoo-1",
    slicerId: "orca",
    profileId: "orca/elegoo-pla-0.2",
  },
};

export async function resolveStation(id: string): Promise<Station> {
  const s = SEED[id];
  if (!s) throw new Error(`unknown station ${id}`);
  return s;
}
