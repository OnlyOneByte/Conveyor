import type { Scene } from "../scene.ts";

const WHERE = "#make-where";
const NOTICE = `${WHERE} [role=alert] >> text=Can't reach Conveyor`;

export const scenes: Scene[] = [
  {
    name: "make-printers-down",
    route: "/",
    ready: "text=How big?",
    steps: [
      { fulfill: "**/api/catalog/printers", method: "GET", status: 500, json: {} },
      { reload: true },
      { waitFor: NOTICE },
      { waitFor: `${WHERE} >> text=The printer list didn't load.` },
      { waitFor: `${WHERE} button:has-text('Try again')` },
      { waitFor: "main >> text=Printers didn't load" },
      { absent: ".dock a.print" },
      { absent: ".dock >> text=Add a printer, then print." },
      { waitFor: ".dock button.print >> text=Print" },
      { absent: `${WHERE} >> text=Add your first printer` },
    ],
  },
  {
    name: "make-printers-retry",
    route: "/",
    ready: "text=How big?",
    widths: [1440],
    steps: [
      { fulfill: "**/api/catalog/printers", method: "GET", status: 500, json: {}, times: 2 },
      { reload: true },
      { waitFor: NOTICE },
      { click: `${WHERE} button:has-text('Try again')` },
      { waitFor: `${WHERE} h2:focus` },
      { absent: NOTICE },
    ],
  },
  {
    name: "make-all-down",
    route: "/",
    ready: "text=How big?",
    widths: [1440],
    steps: [
      { fulfill: "**/api/generators", method: "GET", status: 500, json: {} },
      { fulfill: "**/api/catalog/printers", method: "GET", status: 500, json: {} },
      { reload: true },
      { waitFor: NOTICE },
      { absent: "main p.note" },
    ],
  },
];
