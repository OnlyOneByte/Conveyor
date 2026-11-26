import type { Scene, Step } from "../scene.ts";
import { fleet } from "./13-printers.ts";

const held = fleet.map((printer) =>
  printer.id === "klipper-garage"
    ? {
        ...printer,
        hold: {
          jobId: "seed-failed",
          reason: "moonraker gave no answer to print start within 30000 ms",
          at: Date.UTC(2026, 0, 1, 12, 31),
        },
      }
    : printer,
);

const heldPage = (name: string, extra: Step[] = []): Scene => ({
  name,
  route: "/settings",
  ready: "h1",
  steps: [
    { fulfill: "**/api/catalog/printers", method: "GET", status: 200, json: held },
    { fulfill: "**/api/jobs/active", status: 200, json: [] },
    { follow: "/printers" },
    { waitFor: "text=On hold" },
    { wait: 600 },
    ...extra,
  ],
});

export const scenes: Scene[] = [
  heldPage("printers-hold"),
  heldPage("printers-hold-confirm", [
    { click: "role=button[name='Release hold']" },
    { waitFor: "dialog[open] >> text=Release the hold on Garage Klipper?" },
    { wait: 400 },
  ]),
];
