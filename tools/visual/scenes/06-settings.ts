import type { Scene, Step } from "../scene.ts";

const bundled = (id: string, name: string, gcodeFlavor: string, extra: object = {}) => ({
  id,
  slicerId: id.split("/")[0],
  name,
  path: `/profiles/${id.replace("/", "-")}`,
  gcodeFlavor,
  bundled: true,
  ...extra,
});

const profiles = [
  bundled("orca/klipper-pla-0.2", "Klipper PLA 0.2mm (Orca)", "klipper", {
    hasEditableContent: true,
  }),
  bundled("prusa/klipper-pla-0.2", "Klipper PLA 0.2mm (Prusa)", "klipper"),
  bundled("prusa/marlin-pla-0.2", "Marlin PLA 0.2mm (Prusa)", "marlin"),
  {
    id: "orca/voron-petg-0-25mm",
    slicerId: "orca",
    name: "Voron PETG 0.25mm",
    path: "/profiles/voron-petg-0-25mm",
    gcodeFlavor: "klipper",
    bundled: false,
  },
];

const dialog = "dialog[open]";

const page = (name: string, extra: Step[] = [], fullPage = true): Scene => ({
  name,
  route: "/printers",
  ready: "h1",
  fullPage,
  steps: [
    { fulfill: "**/api/catalog/profiles", method: "GET", status: 200, json: profiles },
    { follow: "/settings" },
    { waitFor: "text=Voron PETG 0.25mm" },
    { wait: 400 },
    ...extra,
  ],
});

const editor = (name: string, extra: Step[] = []): Scene => ({
  name,
  route: "/printers",
  ready: "h1",
  steps: [
    { follow: "/settings/profiles/orca/klipper-pla-0.2" },
    { waitFor: ".cm-content" },
    { wait: 400 },
    ...extra,
  ],
});

const added = (name: string) => ({
  id: `orca/${name.toLowerCase().replace(/\W+/g, "-")}`,
  slicerId: "orca",
  name,
  path: "/profiles/added",
  gcodeFlavor: "klipper",
  bundled: false,
});

const shipped = profiles.slice(0, 3);

const deleting = (
  name: string,
  label: string,
  before: object[],
  after: object[],
  lands: string,
) => {
  const scene: Scene = {
    name,
    route: "/printers",
    ready: "h1",
    widths: [1440],
    steps: [
      { fulfill: "**/api/catalog/profiles", method: "GET", status: 200, json: after },
      { fulfill: "**/api/catalog/profiles", method: "GET", status: 200, json: before, times: 1 },
      { fulfill: "**/api/catalog/profiles/*", method: "DELETE", status: 200, json: { ok: true } },
      { follow: "/settings" },
      { waitFor: `text=${label}` },
      { click: `role=button[name='Delete ${label}']` },
      { waitFor: `${dialog} >> role=button[name='Delete profile']` },
      { press: "Tab" },
      { press: "Enter" },
      { waitFor: `${lands}:focus`, timeout: 5000 },
      { wait: 300 },
    ],
  };
  return scene;
};

export const scenes: Scene[] = [
  page("settings"),
  page(
    "settings-add",
    [
      { click: "role=button[name='Add profile']" },
      { waitFor: dialog },
      { click: `${dialog} >> role=button[name='Add profile']` },
      { waitFor: `${dialog} >> text=Give the profile a name.` },
      { wait: 300 },
    ],
    false,
  ),
  page(
    "settings-delete",
    [
      { click: "role=button[name='Delete Voron PETG 0.25mm']" },
      { waitFor: `${dialog} >> text=Delete Voron PETG 0.25mm?` },
      { wait: 300 },
    ],
    false,
  ),
  deleting(
    "settings-delete-focus-next",
    "Added first",
    [added("Added first"), ...shipped],
    shipped,
    "a[aria-label='Edit Klipper PLA 0.2mm (Orca)']",
  ),
  deleting(
    "settings-delete-focus-middle",
    "Middle one",
    [shipped[0], added("Middle one"), ...shipped.slice(1)],
    shipped,
    "a[aria-label='Edit Klipper PLA 0.2mm (Prusa)']",
  ),
  deleting(
    "settings-delete-focus-previous",
    "Zed last",
    [...shipped, added("Zed last")],
    shipped,
    "a[aria-label='Edit Marlin PLA 0.2mm (Prusa)']",
  ),
  deleting(
    "settings-delete-focus-empty",
    "Only one",
    [added("Only one")],
    [],
    "button:has-text('Add profile')",
  ),
  {
    name: "profile-editor-offline",
    route: "/printers",
    ready: "h1",
    steps: [
      { offline: "h1", only: "editor" },
      {
        fulfill: "**/content",
        method: "GET",
        status: 200,
        json: {
          format: "orca-json",
          source: "edited",
          documents: { machine: '{"type": "machine"}', process: "{}", filament: "{}" },
        },
      },
      { follow: "/settings/profiles/orca/klipper-pla-0.2" },
      { waitFor: "text=The editor needs a connection to load.", timeout: 5000 },
      { waitFor: "button:has-text('Tidy layout'):disabled", timeout: 3000 },
      { waitFor: "button:has-text('Save'):disabled", timeout: 3000 },
      { waitFor: "button:has-text('Reset to original'):disabled", timeout: 3000 },
      { poke: "button:has-text('Tidy layout')" },
      { poke: "button:has-text('Save')" },
      { press: "Control+s" },
      { poke: "button:has-text('Reset to original')" },
      { wait: 500 },
      { absent: "dialog[open]" },
      { unsent: "*" },
    ],
  },
  {
    name: "profile-editor-long-error",
    route: "/printers",
    ready: "h1",
    steps: [
      {
        fulfill: "**/api/catalog/profiles/*/content",
        method: "GET",
        status: 500,
        json: { error: `  ${"databaseislocked".repeat(12_500)}  ` },
      },
      { follow: "/settings/profiles/orca/klipper-pla-0.2" },
      { waitFor: "text=Conveyor answered:", timeout: 5000 },
      { fits: "text=Conveyor answered:" },
    ],
  },
  editor("profile-editor"),
  editor("profile-editor-error", [
    { click: ".cm-content" },
    { press: "Control+Home" },
    { press: "ArrowDown" },
    { press: "End" },
    { press: "Backspace" },
    { waitFor: "text=Machine, line 3: this isn't valid JSON." },
    { wait: 500 },
  ]),
];
