import type { Scene } from "../scene.ts";

export const scenes: Scene[] = [
  {
    name: "profile-editor-reconnect",
    route: "/printers",
    ready: "h1",
    steps: [
      { offline: "h1", only: "editor" },
      { follow: "/settings/profiles/orca/klipper-pla-0.2" },
      { waitFor: "text=You're offline", timeout: 5000 },
      { absent: "button:has-text('Save')" },
      { reconnect: "editor" },
      { click: "button:has-text('Try again')" },
      { waitFor: ".cm-content:focus", timeout: 10000 },
      { waitFor: "button:has-text('Save') >> visible=true", timeout: 5000 },
      { absent: "text=You're offline" },
      { wait: 500 },
    ],
  },
];
