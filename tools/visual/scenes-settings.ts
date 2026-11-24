import type { Scene } from "./scenes.ts";

const printerFormScenes: Scene[] = [
  { printer: "Elegoo Neptune", field: "Mainboard ID", slug: "elegoo" },
  { printer: "Garage Klipper", field: "API key / secret", slug: "moonraker" },
].map(({ printer, field, slug }) => ({
  name: `printer-form-${slug}`,
  route: "/settings",
  ready: `tr:has-text('${printer}')`,
  steps: [
    { click: `tr:has-text('${printer}') >> button:has-text('Edit')` },
    { waitFor: `label:has-text('${field}')` },
    { scroll: `label:has-text('${field}')` },
    { wait: 400 },
  ],
}));

export const settingsScenes: Scene[] = [
  { name: "settings", route: "/settings", ready: "h1", steps: [{ wait: 800 }] },
  ...printerFormScenes,
];
