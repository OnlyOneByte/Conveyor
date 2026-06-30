import type { Station } from "../station.js";
import type { Printer, Profile } from "./index.js";

/**
 * The default catalog Conveyor ships with — identical to the M0 in-memory seeds
 * (api/stations-store.ts + worker/stations.ts), now the first-boot rows of the
 * SQLite store. Seeded only when the stations table is empty, so admin edits
 * survive restarts.
 */
export const DEFAULT_PROFILES: Profile[] = [
  // OrcaSlicer klipper bundle (Creality K1 family leaf exports) — VERIFIED slicing
  // a cube → klipper gcode in the worker image 2026-06-30. See docs/M1-WORKER-ENGINES.md.
  { id: "orca/klipper-pla-0.2", slicerId: "orca", name: "Klipper PLA 0.2mm (Orca)", path: "/profiles/orca-klipper-pla-0.2", gcodeFlavor: "klipper" },
  // PrusaSlicer is multi-arch (apt) and headless-verified — see docs/M1-WORKER-ENGINES.md.
  { id: "prusa/klipper-pla-0.2", slicerId: "prusa", name: "Klipper PLA 0.2mm (Prusa)", path: "/profiles/prusa-klipper-pla-0.2", gcodeFlavor: "klipper" },
  { id: "prusa/marlin-pla-0.2", slicerId: "prusa", name: "Marlin PLA 0.2mm (Prusa)", path: "/profiles/prusa-marlin-pla-0.2", gcodeFlavor: "marlin" },
];

export const DEFAULT_PRINTERS: Printer[] = [
  { id: "klipper-garage", transportId: "moonraker", name: "Garage Klipper", address: "127.0.0.1:7125" },
  { id: "elegoo-1", transportId: "elegoo", name: "Elegoo Neptune", address: "127.0.0.1" },
];

export const DEFAULT_STATIONS: Station[] = [
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
    // Klipper-flavored bundle: modern Elegoo printers (e.g. Centauri) run Klipper,
    // and the elegoo transport accepts klipper. Admins can swap in a marlin profile
    // (e.g. prusa/marlin-pla-0.2) for older Neptune/Marlin boards.
    profileId: "orca/klipper-pla-0.2",
  },
  {
    id: "garage-klipper-prusa-pla",
    name: "Garage Klipper — PLA 0.2mm (PrusaSlicer)",
    transportId: "moonraker",
    printerId: "klipper-garage",
    slicerId: "prusa",
    profileId: "prusa/klipper-pla-0.2",
  },
];
