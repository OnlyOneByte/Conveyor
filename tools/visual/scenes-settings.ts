import type { Scene } from "./scenes.ts";

export const settingsScenes: Scene[] = [
  { name: "settings", route: "/settings", ready: "h1", steps: [{ wait: 800 }] },
];
