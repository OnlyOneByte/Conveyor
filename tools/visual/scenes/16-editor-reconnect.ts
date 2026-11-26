import type { Scene } from "../scene.ts";

const ALERT = ".notice [role='alert'] b";
const RETRY = ".notice button";

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
      { mark: ALERT },
      { click: RETRY },
      { waitFor: `${RETRY}:focus >> text=Try again`, timeout: 5000 },
      { absent: `${ALERT}[data-mark]` },
      { waitFor: `${ALERT} >> text=You're offline`, timeout: 3000 },
      { reconnect: "editor", delayMs: 1500 },
      { press: "Enter" },
      { waitFor: `${RETRY} >> text=Trying…`, timeout: 3000 },
      { press: "Enter" },
      { press: "Enter" },
      { press: " " },
      { press: "Enter" },
      { waitFor: ".cm-content:focus", timeout: 15000 },
      { wait: 2000 },
      { absent: ".code .cm-editor ~ .cm-editor" },
      { waitFor: "button:has-text('Save') >> visible=true", timeout: 5000 },
      { absent: "text=You're offline" },
    ],
  },
];
