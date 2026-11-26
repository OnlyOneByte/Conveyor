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

const added = (name: string) => ({
  id: `orca/${name.toLowerCase().replace(/\W+/g, "-")}`,
  slicerId: "orca",
  name,
  path: "/profiles/added",
  gcodeFlavor: "klipper",
  bundled: false,
});

const profiles = [
  bundled("orca/klipper-pla-0.2", "Klipper PLA 0.2mm (Orca)", "klipper", {
    hasEditableContent: true,
  }),
  bundled("prusa/klipper-pla-0.2", "Klipper PLA 0.2mm (Prusa)", "klipper"),
  bundled("prusa/marlin-pla-0.2", "Marlin PLA 0.2mm (Prusa)", "marlin"),
  { ...added("Voron PETG 0.25mm"), path: "/profiles/voron-petg-0-25mm" },
];

const edit = (id: string) => `a[href='/settings/profiles/${id}']`;

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

const longError = (
  name: string,
  extra: Step[],
  reason = `  ${"databaseislocked".repeat(12_500)}  `,
): Scene => ({
  name,
  route: "/printers",
  ready: "h1",
  steps: [
    {
      fulfill: "**/api/catalog/profiles/*/content",
      method: "GET",
      status: 500,
      json: { error: reason },
    },
    { follow: "/settings/profiles/orca/klipper-pla-0.2" },
    { waitFor: "text=Conveyor hit a problem loading this.", timeout: 5000 },
    ...extra,
  ],
});

const shipped = profiles.slice(0, 3);
const plain = bundled("stub/plain-pla", "Plain PLA (no editor)", "klipper");

const deleting = (
  name: string,
  label: string,
  before: object[],
  after: object[],
  lands: string,
): Scene => ({
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
});

export const scenes: Scene[] = [
  page("settings", [{ waitFor: "role=link[name=/Bundled, edited/]" }]),
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
    edit("orca/klipper-pla-0.2"),
  ),
  deleting(
    "settings-delete-focus-middle",
    "Middle one",
    [shipped[0], added("Middle one"), ...shipped.slice(1)],
    shipped,
    edit("prusa/klipper-pla-0.2"),
  ),
  deleting(
    "settings-delete-focus-previous",
    "Zed last",
    [...shipped, added("Zed last")],
    shipped,
    edit("prusa/marlin-pla-0.2"),
  ),
  deleting(
    "settings-delete-focus-plain",
    "Gone soon",
    [added("Gone soon"), plain],
    [plain],
    "button:has-text('Add profile')",
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
      { waitFor: "text=You're offline", timeout: 5000 },
      { waitFor: "button:has-text('Try again') >> visible=true", timeout: 3000 },
      { absent: "button:has-text('Tidy layout')" },
      { absent: "button:has-text('Save')" },
      { absent: "button:has-text('Reset to original')" },
      { absent: ".code" },
      { press: "Control+s" },
      { click: "button:has-text('Try again')" },
      { waitFor: ".notice button:focus >> text=Try again", timeout: 5000 },
      { wait: 500 },
      { absent: "dialog[open]" },
      { unsent: "*" },
    ],
  },
  longError("profile-editor-long-error", [
    { absent: "details[open]" },
    { absent: "text=Conveyor answered" },
    { fits: "a:has-text('Back to Settings')" },
  ]),
  longError("profile-editor-long-error-open", [
    { click: "summary >> text=Details" },
    { waitFor: "pre >> text=databaseislocked" },
    { fits: "pre" },
    { wait: 300 },
    { absent: "pre[tabindex]" },
  ]),
  longError(
    "profile-details-scrolls",
    [
      { click: "summary >> text=Details" },
      { waitFor: "pre[tabindex='0']" },
      { tabTo: "pre" },
      { keyScrolls: "pre" },
    ],
    Array.from({ length: 80 }, () => "x").join("\n"),
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
  {
    name: "profile-load-details",
    route: "/printers",
    ready: "h1",
    steps: [
      { fulfill: "**/api/catalog/profiles", method: "GET", status: 500, json: {} },
      { follow: "/settings/profiles/orca/klipper-pla-0.2" },
      { waitFor: "text=Conveyor hit a problem loading this.", timeout: 5000 },
      { click: "summary >> text=Details" },
      { waitFor: "pre >> text=GET /api/catalog/profiles 500" },
      { wait: 300 },
      { absent: "pre[tabindex]" },
    ],
  },
];
