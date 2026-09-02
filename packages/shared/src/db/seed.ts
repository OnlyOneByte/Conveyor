import type { Printer, Profile } from "./index.js";

/**
 * The default catalog Conveyor ships with: the printers you can print to and the
 * slicer profiles you can print with. A job names one of each. Seeded only when the
 * printers table is empty, so edits made in Settings survive restarts.
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

