import { writable } from "svelte/store";

export type Politeness = "polite" | "assertive";

export const announcements = { polite: writable(""), assertive: writable("") };

export function announce(message: string, level: Politeness = "polite"): Promise<void> {
  const region = announcements[level];
  region.set("");
  return Promise.resolve().then(() => region.set(message));
}
