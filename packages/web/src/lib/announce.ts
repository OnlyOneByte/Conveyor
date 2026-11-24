import { writable } from "svelte/store";

export type Politeness = "polite" | "assertive";

const SETTLE_MS = 80;

export const announcements = { polite: writable(""), assertive: writable("") };

export function announce(message: string, level: Politeness = "polite"): Promise<void> {
  const region = announcements[level];
  region.set("");
  return new Promise((done) => setTimeout(() => done(region.set(message)), SETTLE_MS));
}
