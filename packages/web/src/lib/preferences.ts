import { get, writable } from "svelte/store";

const SPIN_KEY = "conveyor.prefs.spinPreview";

const canStore = (): boolean => typeof localStorage !== "undefined";

function read(key: string): boolean {
  if (!canStore()) return false;
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function persist(key: string, value: boolean): void {
  if (!canStore()) return;
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    return;
  }
}

export const spinPreview = writable<boolean>(read(SPIN_KEY));
spinPreview.subscribe((v) => persist(SPIN_KEY, v));

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === SPIN_KEY) spinPreview.set(e.newValue === "1");
  });
}

const SINGLE_KEYS_OFF = "conveyor.prefs.singleKeysOff";

export const singleKeyShortcuts = writable<boolean>(!read(SINGLE_KEYS_OFF));
singleKeyShortcuts.subscribe((on) => persist(SINGLE_KEYS_OFF, !on));

export type Theme = "system" | "light" | "dark";

const THEME_KEY = "conveyor.prefs.theme";

export const toTheme = (value: string | null): Theme =>
  value === "light" || value === "dark" ? value : "system";

const DARK = "(prefers-color-scheme: dark)";

export const resolveTheme = (saved: string | null, osDark: boolean): "light" | "dark" =>
  saved === "light" || saved === "dark" ? saved : osDark ? "dark" : "light";

function applyTheme(choice: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = resolveTheme(choice, matchMedia(DARK).matches);
}

function savedTheme(): Theme {
  try {
    return canStore() ? toTheme(localStorage.getItem(THEME_KEY)) : "system";
  } catch {
    return "system";
  }
}

export const theme = writable<Theme>(savedTheme());
theme.subscribe((choice) => {
  applyTheme(choice);
  try {
    if (canStore()) localStorage.setItem(THEME_KEY, choice);
  } catch {
    return;
  }
});

if (typeof matchMedia !== "undefined") {
  matchMedia(DARK).addEventListener("change", () => applyTheme(get(theme)));
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}
