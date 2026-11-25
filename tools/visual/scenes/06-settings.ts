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
