import type { Scene, Step } from "./scenes.ts";

const AT = Date.UTC(2026, 0, 1, 12, 31);

const fleet = [
  {
    id: "voron",
    transportId: "moonraker",
    name: "Voron 2.4",
    address: "192.168.1.50",
    hasSecrets: true,
    lastSeenAt: AT,
  },
  {
    id: "elegoo-1",
    transportId: "elegoo",
    name: "Elegoo Neptune",
    address: "192.168.1.61",
    hasSecrets: false,
    allowedGenerators: ["gridfinity"],
    lastSeenAt: Date.UTC(2026, 0, 1, 10),
  },
  {
    id: "klipper-garage",
    transportId: "moonraker",
    name: "Garage Klipper",
    address: "garage.local:7125",
    hasSecrets: true,
  },
];

const job = (jobId: string, printerId: string, state: string, extra: object = {}) => ({
  jobId,
  state,
  at: AT,
  printerId,
  profileId: "orca/klipper-pla-0.2",
  generator: { id: "gridfinity", params: { gridX: 2, gridY: 3, heightUnits: 6 } },
  createdAt: AT,
  ...extra,
});

const active = [
  job("scene-printing", "voron", "printing", {
    progress: 0.64,
    print: { layer: 112, layers: 175, secondsLeft: 2460 },
  }),
  job("scene-next", "voron", "queued", {
    createdAt: AT + 60_000,
    generator: { id: "gridfinity", params: { gridX: 1, gridY: 1, heightUnits: 3 } },
  }),
  job("scene-stuck-1", "elegoo-1", "queued", { createdAt: AT + 120_000 }),
  job("scene-stuck-2", "elegoo-1", "queued", {
    createdAt: AT + 180_000,
    generator: { id: "gridfinity", params: { gridX: 2, gridY: 2, heightUnits: 3 } },
  }),
];

const reachable = (id: string, json: object): Step => ({
  fulfill: `**/api/catalog/printers/${id}/reachable`,
  status: 200,
  json,
});

const stubbed: Step[] = [
  { fulfill: "**/api/catalog/printers", method: "GET", status: 200, json: fleet },
  { fulfill: "**/api/jobs/active", status: 200, json: active },
  reachable("voron", { reachable: true, latencyMs: 9, host: "192.168.1.50", port: 80 }),
  reachable("elegoo-1", { reachable: false, host: "192.168.1.61", port: 3030, reason: "timeout" }),
  reachable("klipper-garage", { reachable: true, latencyMs: 12, host: "garage.local", port: 7125 }),
];

const fleetPage = (name: string, extra: Step[] = [], record = false): Scene => ({
  name,
  route: "/settings",
  ready: "h1",
  record,
  steps: [
    ...stubbed,
    { follow: "/printers" },
    { waitFor: "text=Answered in 12 ms." },
    { waitFor: "#belt >> text=3 waiting >> visible=true" },
    { wait: 600 },
    ...extra,
  ],
});

const dialog = "dialog[open]";
const press = (...keys: string[]): Step[] => keys.flatMap((key) => [{ press: key }, { wait: 150 }]);
const added = {
  id: "mk4",
  transportId: "moonraker",
  name: "MK4",
  address: "10.0.0.9",
  hasSecrets: false,
};
const field = (name: string) => `${dialog} >> role=textbox[name="${name}"s]`;

export const printersScenes: Scene[] = [
  fleetPage("printers"),
  fleetPage(
    "printers-keys",
    [
      { click: "h1" },
      ...press("Tab", "Enter"),
      { waitFor: `${dialog} input:focus` },
      ...press("Enter"),
      { waitFor: `${dialog} >> text=Give the printer a name.` },
      { waitFor: `${dialog} input[aria-invalid='true']:focus` },
      ...press("M", "K", "4", "Tab", "Tab", "Tab", "1", "0", ".", "0", ".", "0", ".", "9"),
      { fulfill: "**/api/catalog/printers", method: "PUT", status: 200, json: { ok: true } },
      { fulfill: "**/api/catalog/printers", method: "GET", status: 200, json: [...fleet, added] },
      reachable("mk4", { reachable: true, latencyMs: 5, host: "10.0.0.9", port: 80 }),
      ...press("Enter"),
      { waitFor: "text=Added MK4" },
      { waitFor: "text=Answered in 5 ms." },
      { wait: 600 },
    ],
    true,
  ),
  fleetPage("printers-add-invalid", [
    { click: "button:has-text('Add printer')" },
    { waitFor: `${dialog} >> text=Connection` },
    { click: `${dialog} button[type=submit]` },
    { waitFor: "text=Give the printer a name." },
    { wait: 400 },
  ]),
  fleetPage(
    "printers-add",
    [
      { click: "button:has-text('Add printer')" },
      { waitFor: `${dialog} >> text=Connection` },
      { click: `${dialog} button[type=submit]` },
      { waitFor: "text=Enter the printer's address." },
      { wait: 600 },
      { type: field("Name"), text: "Prusa MK4" },
      { type: field("Address"), text: "192.168.1.72" },
      { wait: 600 },
      { fulfill: "**/api/catalog/printers", method: "PUT", status: 200, json: { ok: true } },
      {
        fulfill: "**/api/catalog/printers",
        method: "GET",
        status: 200,
        json: [
          ...fleet,
          {
            id: "prusa-mk4",
            transportId: "moonraker",
            name: "Prusa MK4",
            address: "192.168.1.72",
            hasSecrets: false,
          },
        ],
      },
      reachable("prusa-mk4", { reachable: true, latencyMs: 7, host: "192.168.1.72", port: 80 }),
      { click: `${dialog} button[type=submit]` },
      { waitFor: "text=Added Prusa MK4" },
      { waitFor: "text=Answered in 7 ms." },
      { wait: 800 },
    ],
    true,
  ),
  fleetPage(
    "printers-clear-secrets",
    [
      { click: "button[aria-label='Edit Garage Klipper']" },
      { waitFor: `${dialog} >> text=Secrets are saved for this printer.` },
      { wait: 600 },
      { fulfill: "**/api/catalog/printers", method: "PUT", status: 200, json: { ok: true } },
      {
        fulfill: "**/api/catalog/printers",
        method: "GET",
        status: 200,
        json: fleet.map((printer) =>
          printer.id === "klipper-garage" ? { ...printer, hasSecrets: false } : printer,
        ),
      },
      { click: `${dialog} button:has-text('Clear saved secrets')` },
      { waitFor: "text=Saved secrets cleared." },
      { wait: 800 },
    ],
    true,
  ),
  fleetPage("printers-delete", [
    { click: "button[aria-label='Edit Elegoo Neptune']" },
    { waitFor: `${dialog} >> text=Mainboard ID` },
    { click: `${dialog} button:has-text('Delete printer')` },
    { waitFor: `${dialog} >> text=to finish or be canceled first` },
    { wait: 400 },
  ]),
  ...[
    { printer: "Elegoo Neptune", field: "Mainboard ID", slug: "elegoo" },
    { printer: "Garage Klipper", field: "API key", slug: "moonraker" },
  ].map(({ printer, field: label, slug }) => ({
    name: `printer-form-${slug}`,
    route: "/printers",
    ready: `h2:has-text('${printer}')`,
    steps: [
      { click: `button[aria-label='Edit ${printer}']` },
      { waitFor: `${dialog} >> label:has-text('${label}')` },
      { wait: 400 },
    ],
  })),
];
