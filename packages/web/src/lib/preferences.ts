import { get, writable } from "svelte/store";

/**
 * Per-browser view preferences.
 *
 * These are NOT server state: they describe how *this* browser renders, not
 * anything about the catalog, so they live in localStorage rather than in SQLite.
 * That also means they are deliberately per-device — the same choice on a phone
 * and a desktop is two separate settings.
 */

const SPIN_KEY = "conveyor.prefs.spinPreview";

const canStore = (): boolean => typeof localStorage !== "undefined";

function read(key: string): boolean {
  if (!canStore()) return false;
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false; // private mode / storage blocked
  }
}

function persist(key: string, value: boolean): void {
  if (!canStore()) return;
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    /* non-fatal — the preference just won't survive a reload */
  }
}

/**
 * Auto-spin the 3D preview. **Off by default**: a permanently rotating model is
 * distracting while you are dialling in parameters, and it fights manual orbiting
 * (the camera drifts the moment you let go).
 */
export const spinPreview = writable<boolean>(read(SPIN_KEY));
spinPreview.subscribe((v) => persist(SPIN_KEY, v));

// The toggle lives on /settings while the viewer lives on /, so a user can easily
// have both open in separate tabs. `storage` only fires in OTHER tabs, so this
// syncs them without looping on our own writes.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === SPIN_KEY) spinPreview.set(e.newValue === "1");
  });
}

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

/**
 * Whether the OS asked for reduced motion. Users who did never get auto-spin,
 * whatever the preference above says — `autoRotate` is a render-loop prop rather
 * than a CSS animation, so the global `@media (prefers-reduced-motion)` guard in
 * app.css cannot reach it.
 */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}
