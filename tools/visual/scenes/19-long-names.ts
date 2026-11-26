import type { Scene, Step } from "../scene.ts";

const LONG = "Gridfinity Bin with Magnet Holes, Label Tab and Stacking Lip for the Garage Drawer";

const WORD = "GarageDrawer".repeat(7).slice(0, 80);

const printerNamed = (name: string): Step => ({
  fulfill: "**/api/catalog/printers",
  method: "GET",
  status: 200,
  json: [{ id: "elegoo-1", transportId: "elegoo", name, address: "127.0.0.1", hasSecrets: false }],
});

const longPrinter = printerNamed(LONG);

const named = (
  name: string,
  route: string,
  ready: string,
  steps: Step[],
  stub = longPrinter,
): Scene => ({
  name,
  route: "/settings",
  ready: "h1",
  visits: [route],
  fullPage: false,
  steps: [stub, { follow: route }, { waitFor: ready }, ...steps, { wait: 300 }],
});

export const scenes: Scene[] = [
  named("long-printer-dock", "/", ".dock >> text=Garage Drawer", [
    { lines: ".dock .sum b", max: 2 },
  ]),
  named(
    "long-printer-dock-word",
    "/",
    `.dock >> text=${WORD.slice(0, 24)}`,
    [
      { lines: ".dock .sum b", max: 2 },
      { computed: ".dock .sum b", property: "overflow-wrap", matches: "^anywhere$" },
    ],
    printerNamed(WORD),
  ),
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
      { computed: "main .pr", property: "overflow-x", matches: "^hidden$" },
      { computed: "main .pr", property: "text-overflow", matches: "^ellipsis$" },
      { wait: 300 },
    ],
  },
  named("long-printer-card", "/printers", "main h2 >> text=Garage Drawer", [
    { lines: "main .card h2", max: 2 },
  ]),
];
