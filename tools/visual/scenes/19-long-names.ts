import type { Scene, Step } from "../scene.ts";

const LONG = "Gridfinity Bin with Magnet Holes, Label Tab and Stacking Lip for the Garage Drawer";

const longPrinter: Step = {
  fulfill: "**/api/catalog/printers",
  method: "GET",
  status: 200,
  json: [
    { id: "elegoo-1", transportId: "elegoo", name: LONG, address: "127.0.0.1", hasSecrets: false },
  ],
};

const named = (name: string, route: string, ready: string, steps: Step[]): Scene => ({
  name,
  route: "/settings",
  ready: "h1",
  visits: [route],
  fullPage: false,
  steps: [longPrinter, { follow: route }, { waitFor: ready }, ...steps, { wait: 300 }],
});

export const scenes: Scene[] = [
  named("long-printer-dock", "/", ".dock >> text=Garage Drawer", [
    { lines: ".dock .sum b", max: 2 },
  ]),
  {
    name: "long-printer-jobs",
    route: "/jobs",
    ready: "h1",
    widths: [1440],
    fullPage: false,
    steps: [
      longPrinter,
      { reload: true },
      { waitFor: "main .pr >> text=Garage Drawer" },
      { lines: "main .pr >> nth=0", max: 1 },
      { wait: 300 },
    ],
  },
  named("long-printer-card", "/printers", "main h2 >> text=Garage Drawer", [
    { lines: "main .card h2", max: 2 },
  ]),
];
