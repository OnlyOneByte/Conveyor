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

const heldElegoo = fleet.map((printer) =>
  printer.id === "elegoo-1"
    ? { ...printer, hold: { jobId: "seed-failed", reason: "no answer to print start", at: 0 } }
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
  {
    name: "receipt-held",
    route: "/settings",
    ready: "h1",
    visits: ["/jobs/seed-failed", "/printers"],
    steps: [
      { fulfill: "**/api/catalog/printers", method: "GET", status: 200, json: heldElegoo },
      { follow: "/jobs/seed-failed" },
      { waitFor: "main .acts a.btn.primary[href='/printers'] >> text=Check the printer" },
      { absent: "main button:has-text('Retry')" },
      { waitFor: "main .why[role=note] >> text=didn't finish" },
      { waitFor: "main .held[role=note] >> text=The printer is on hold" },
      { wait: 400 },
      { click: "main a.btn.primary >> text=Check the printer" },
      { waitFor: "main h1 >> text=Printers" },
      { waitFor: "text=On hold" },
    ],
  },
  {
    name: "receipt-held-again",
    route: "/settings",
    ready: "h1",
    visits: ["/jobs/seed-printed", "/printers"],
    steps: [
      { fulfill: "**/api/catalog/printers", method: "GET", status: 200, json: heldElegoo },
      { follow: "/jobs/seed-printed" },
      { waitFor: "main .acts a.btn.primary[href='/printers'] >> text=Check the printer" },
      { absent: "main button:has-text('Print again')" },
      { waitFor: "main .held[role=note] >> text=The printer is on hold" },
      { absent: "main .why" },
      { wait: 400 },
      { click: "main a.btn.primary >> text=Check the printer" },
      { waitFor: "main h1 >> text=Printers" },
      { waitFor: "text=On hold" },
    ],
  },
  heldPage("printers-hold"),
  heldPage("printers-hold-details", [
    { click: "text=Details" },
    { waitFor: "details[open] >> text=moonraker gave no answer" },
    { wait: 300 },
  ]),
  heldPage("printers-hold-confirm", [
    { click: "role=button[name='Release hold']" },
    { waitFor: "dialog[open] >> text=Release the hold on Garage Klipper?" },
    { wait: 400 },
  ]),
];
