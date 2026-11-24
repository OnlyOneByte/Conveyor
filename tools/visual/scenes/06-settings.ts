import type { Scene } from "../scene.ts";

export const scenes: Scene[] = [
  { name: "settings", route: "/settings", ready: "h1", steps: [{ wait: 800 }] },
];
