import type { PrinterInput } from "./printers.js";
import type { Profile } from "./profiles.js";

export const DEFAULT_PROFILES: Profile[] = [
  {
    id: "orca/klipper-pla-0.2",
    slicerId: "orca",
    name: "Klipper PLA 0.2mm (Orca)",
    path: "/profiles/orca-klipper-pla-0.2",
    gcodeFlavor: "klipper",
  },
  {
    id: "prusa/klipper-pla-0.2",
    slicerId: "prusa",
    name: "Klipper PLA 0.2mm (Prusa)",
    path: "/profiles/prusa-klipper-pla-0.2",
    gcodeFlavor: "klipper",
  },
  {
    id: "prusa/marlin-pla-0.2",
    slicerId: "prusa",
    name: "Marlin PLA 0.2mm (Prusa)",
    path: "/profiles/prusa-marlin-pla-0.2",
    gcodeFlavor: "marlin",
  },
];

export const DEFAULT_PRINTERS: Omit<PrinterInput, "secrets">[] = [
  {
    id: "klipper-garage",
    transportId: "moonraker",
    name: "Garage Klipper",
    address: "127.0.0.1:7125",
  },
  { id: "elegoo-1", transportId: "elegoo", name: "Elegoo Neptune", address: "127.0.0.1" },
];
