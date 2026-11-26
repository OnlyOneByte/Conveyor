import type { Scene, Step } from "../scene.ts";

const noPrinters: Step = {
  fulfill: "**/api/catalog/printers",
  method: "GET",
  status: 200,
  json: [],
};

const uploadOnly: Step = {
  fulfill: "**/api/catalog/printers",
  method: "GET",
  status: 200,
  json: [
    {
      id: "stl-only",
      transportId: "moonraker",
      name: "STL Only",
      address: "10.0.0.5",
      hasSecrets: false,
      allowedGenerators: ["passthrough"],
    },
  ],
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
      { press: "Escape" },
      { waitFor: "main .acts button.primary:focus >> text=Add printer" },
      { waitFor: "main .first h2 >> text=Add your first printer" },
      { absent: "main .first .btn" },
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
      { absent: "main .first .btn" },
      { wait: 400 },
    ],
  },
  {
    name: "first-run-limited",
    route: "/settings",
    ready: "h1",
    visits: ["/"],
    steps: [
      uploadOnly,
      { follow: "/" },
      { waitFor: "#make-where >> text=No printer can print this yet." },
      { absent: "#make-where .first" },
      { absent: ".dock >> text=Add a printer to print" },
      { wait: 400 },
    ],
  },
];
