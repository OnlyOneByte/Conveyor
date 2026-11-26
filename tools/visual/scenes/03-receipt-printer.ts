import type { Scene } from "../scene.ts";

const refused = (name: string, reason: string, says: string): Scene => ({
  name,
  route: "/jobs",
  ready: "h1",
  steps: [
    {
      fulfill: "**/api/jobs-history/seed-failed",
      status: 200,
      json: {
        id: "seed-failed",
        request: {
          generator: { id: "gridfinity", params: { gridX: 1, gridY: 1, heightUnits: 3 } },
          printerId: "klipper-garage",
          profileId: "orca/klipper-pla-0.2",
        },
        state: "failed",
        stage: "transport",
        error: { stage: "transport", reason },
        artifacts: {},
        createdAt: 1767225600000,
        updatedAt: 1767225600000,
      },
    },
    { follow: "/jobs/seed-failed" },
    { waitFor: `text=${says}` },
    { wait: 1200 },
  ],
});

export const scenes: Scene[] = [
  refused(
    "receipt-printer-busy",
    "printer is busy: moonraker reports it printing",
    "The printer is busy with another print.",
  ),
  refused(
    "receipt-printer-error",
    "printer reports an error: elegoo says error",
    "The printer reports an error.",
  ),
  refused(
    "receipt-printer-unchecked",
    "elegoo idle check from 192.0.2.8: no status within 15000 ms",
    "Conveyor couldn't check that the printer is free",
  ),
  refused(
    "receipt-printer-held",
    "printer is on hold: moonraker gave no answer to print start within 30000 ms",
    "The printer is on hold until someone checks it.",
  ),
  refused(
    "receipt-printer-start",
    "moonraker gave no answer to print start within 30000 ms",
    "Conveyor has put the printer on hold",
  ),
];
