import type { Station } from "@conveyor/shared";

/**
 * M0 stub: in-memory seed Stations. M4 swaps this for the SQLite-backed store
 * (see docs/DATA-MODEL.md) — the function signatures stay identical so callers
 * (routes, validation) never change.
 */
const SEED: Station[] = [
  {
    id: "garage-klipper-pla",
    name: "Garage Klipper — PLA 0.2mm",
    transportId: "moonraker",
    printerId: "klipper-garage",
    slicerId: "orca",
    profileId: "orca/klipper-pla-0.2",
  },
  {
    id: "elegoo-pla",
    name: "Elegoo — PLA 0.2mm",
    transportId: "elegoo",
    printerId: "elegoo-1",
    slicerId: "orca",
    profileId: "orca/elegoo-pla-0.2",
  },
];

export async function listStations(): Promise<Station[]> {
  return SEED;
}

export async function getStation(id: string): Promise<Station | undefined> {
  return SEED.find((s) => s.id === id);
}
