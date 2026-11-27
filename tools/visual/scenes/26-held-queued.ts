import type { Scene, Step } from "../scene.ts";
import { fleet } from "./13-printers.ts";

const queued = {
  jobId: "held-queued",
  state: "queued",
  at: Date.UTC(2026, 0, 1, 12, 40),
  message: "waiting: the printer is on hold (no answer to print start)",
  printerId: "klipper-garage",
  profileId: "orca/klipper-pla-0.2",
  generator: { id: "gridfinity", params: { gridX: 2, gridY: 3, heightUnits: 6 } },
  createdAt: Date.UTC(2026, 0, 1, 12, 40),
};

const printers = (held: boolean) =>
  fleet.map((printer) =>
    held && printer.id === queued.printerId
      ? { ...printer, hold: { jobId: "seed-failed", reason: "no answer to print start", at: 0 } }
      : printer,
  );

const opened = (held: boolean): Step[] => [
  { fulfill: "**/api/catalog/printers", method: "GET", status: 200, json: printers(held) },
  { fulfill: `**/api/jobs/${queued.jobId}`, method: "GET", status: 200, json: queued },
  { fulfill: "**/api/jobs/active", status: 200, json: [queued] },
  { follow: `/jobs/${queued.jobId}` },
  { waitFor: "main h1 >> text=Gridfinity Bin" },
  { waitFor: "main button >> text=Cancel" },
];

export const scenes: Scene[] = [
  {
    name: "queued-held",
    route: "/settings",
    ready: "h1",
    visits: [`/jobs/${queued.jobId}`],
    steps: [
      ...opened(true),
      { waitFor: "main .live .held[role=note] >> text=The printer is on hold" },
      { waitFor: "main .live a.btn.check[href='/printers'] >> text=Check the printer" },
      { absent: "main .live >> text=in line for" },
      { wait: 400 },
    ],
  },
  {
    name: "queued-free",
    route: "/settings",
    ready: "h1",
    visits: [`/jobs/${queued.jobId}`],
    steps: [
      ...opened(false),
      { waitFor: "main .live >> text=in line for the Garage Klipper" },
      { absent: "main .held[role=note]" },
      { absent: "main .live a.btn.check" },
      { wait: 400 },
    ],
  },
];
