import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { get } from "svelte/store";

const os = { dark: false, reducedMotion: false, changed: [] as (() => void)[] };
const saved = new Map<string, string>();
const painted: string[] = [];
const root = { dataset: {} as Record<string, string> };
const canvas = () => ({
  getContext: () => ({
    set fillStyle(value: string) {
      painted.push(value);
    },
    fillRect: () => {},
    getImageData: () => ({ data: [243, 104, 15, 255] }),
  }),
});
const storageListeners: ((event: { key: string | null; newValue: string | null }) => void)[] = [];
const fakes = {
  window: {
    addEventListener: (_type: string, run: (typeof storageListeners)[number]) =>
      void storageListeners.push(run),
  },
  document: { documentElement: root, createElement: canvas },
  localStorage: {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => void saved.set(key, value),
  },
  matchMedia: (query: string) => ({
    matches: query.includes("reduced-motion") ? os.reducedMotion : os.dark,
    addEventListener: (_event: string, run: () => void) => void os.changed.push(run),
  }),
  getComputedStyle: () => ({ getPropertyValue: (name: string) => `value of ${name}` }),
};
Object.assign(globalThis, fakes);
const prefs = await import("./preferences");
const { tokenColor } = await import("./token-color");

afterAll(() => {
  for (const key of Object.keys(fakes)) Reflect.deleteProperty(globalThis, key);
});

const osChanges = (dark: boolean) => {
  os.dark = dark;
  for (const run of os.changed) run();
};

describe("the theme", () => {
  test("follows the OS in system mode, and an explicit choice wins and is saved", () => {
    expect([get(prefs.theme), root.dataset.theme]).toEqual(["system", "light"]);
    osChanges(true);
    expect(root.dataset.theme).toBe("dark");
    prefs.theme.set("light");
    osChanges(true);
    expect([root.dataset.theme, saved.get("conveyor.prefs.theme")]).toEqual(["light", "light"]);
    prefs.theme.set("system");
    expect([root.dataset.theme, saved.get("conveyor.prefs.theme")]).toEqual(["dark", "system"]);
  });

  test("keeps only light and dark as choices", () => {
    expect(["light", "dark", "system", "blue", null].map(prefs.toTheme)).toEqual([
      "light",
      "dark",
      "system",
      "system",
      "system",
    ]);
  });

  test("app.html's inline script picks the same theme as the module for every OS and saved value", () => {
    const html = readFileSync(join(import.meta.dir, "..", "app.html"), "utf8");
    const script = /<script nonce="%sveltekit.nonce%">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
    expect(script).toContain("conveyor.prefs.theme");
    for (const osDark of [false, true]) {
      for (const value of [null, "light", "dark", "system"]) {
        const page = { documentElement: { dataset: {} as Record<string, string> } };
        const storage = { getItem: () => value };
        new Function("localStorage", "matchMedia", "document", script)(
          storage,
          () => ({ matches: osDark }),
          page,
        );
        expect([osDark, value, page.documentElement.dataset.theme]).toEqual([
          osDark,
          value,
          prefs.resolveTheme(value, osDark),
        ]);
      }
    }
  });
});

describe("tokenColor", () => {
  test("paints the token's computed value and packs the pixel as RGB", () => {
    expect(tokenColor("--accent", "light")).toBe((243 << 16) | (104 << 8) | 15);
    expect(painted.at(-1)).toBe("value of --accent");
  });
});

describe("the other preferences", () => {
  test("follow a change another tab saves, and ignore other keys", () => {
    prefs.spinPreview.set(false);
    for (const run of storageListeners) run({ key: "conveyor.prefs.spinPreview", newValue: "1" });
    expect(get(prefs.spinPreview)).toBe(true);
    for (const run of storageListeners) run({ key: "something.else", newValue: "0" });
    expect(get(prefs.spinPreview)).toBe(true);
  });

  test("single-key shortcuts are on unless turned off, and the choice is saved", () => {
    expect(get(prefs.singleKeyShortcuts)).toBe(true);
    prefs.singleKeyShortcuts.set(false);
    expect(saved.get("conveyor.prefs.singleKeysOff")).toBe("1");
    prefs.singleKeyShortcuts.set(true);
    expect(saved.get("conveyor.prefs.singleKeysOff")).toBe("0");
  });

  test("reduced motion follows the OS setting", () => {
    os.reducedMotion = true;
    expect(prefs.prefersReducedMotion()).toBe(true);
    os.reducedMotion = false;
    expect(prefs.prefersReducedMotion()).toBe(false);
  });
});
