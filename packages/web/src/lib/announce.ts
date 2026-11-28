import { type Writable, writable } from "svelte/store";

export type Politeness = "polite" | "assertive";

const SETTLE_MS = 80;

export const announcements = { polite: writable(""), assertive: writable("") };

export const announcer =
  (regions: Record<Politeness, Writable<string>>) =>
  (message: string, level: Politeness = "polite"): Promise<void> => {
    const region = regions[level];
    region.set("");
    return new Promise((done) => setTimeout(() => done(region.set(message)), SETTLE_MS));
  };

export const announce = announcer(announcements);
