import type { Scene, Step } from "../scene.ts";

const noPrinters: Step = {
  fulfill: "**/api/catalog/printers",
  method: "GET",
  status: 200,
  json: [],
};

export const scenes: Scene[] = [
  {
    name: "first-run-make",
    route: "/",
    ready: "text=How big?",
    visits: ["/printers"],
    steps: [
      noPrinters,
      { follow: "/settings" },
      { follow: "/" },
      { waitFor: "#make-where .first >> text=Add your first printer" },
      { waitFor: ".dock >> text=Add a printer to print" },
      { wait: 400 },
    ],
  },
  {
    name: "first-run-add",
    route: "/",
    ready: "text=How big?",
    visits: ["/printers"],
    widths: [390],
    fullPage: false,
    steps: [
      noPrinters,
      { follow: "/settings" },
      { follow: "/" },
      { click: "#make-where .first a >> text=Add a printer" },
      { waitFor: "dialog[open] >> text=Add printer" },
      { wait: 400 },
    ],
  },
  {
    name: "first-run-printers",
    route: "/settings",
    ready: "h1",
    steps: [
      noPrinters,
      { follow: "/printers" },
      { waitFor: "main .first h2 >> text=Add your first printer" },
      { targets: "main .first" },
      { wait: 400 },
    ],
  },
];
