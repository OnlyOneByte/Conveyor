import { describe, expect, test } from "bun:test";
import { type Command, matchCommands } from "./commands";
import { createShortcuts, keyName, step } from "./shortcuts";

const setup = (singleKeys = true) => {
  const ran: string[] = [];
  const keys = createShortcuts({ singleKeys: () => singleKeys, inField: (target) => target === "field" });
  for (const k of ["mod+k", "n", "g m", "g j", "?"]) keys.register(k, () => ran.push(k));
  return { keys, ran };
};

describe("the shortcut registry", () => {
  test("names keys with mod+ for ⌘ or Ctrl, and lower-cases single letters", () => {
    const names = [{ key: "k", metaKey: true }, { key: "K", ctrlKey: true }, { key: "N" }, { key: "?" }, { key: "Escape" }].map(keyName);
    expect(names).toEqual(["mod+k", "mod+k", "n", "?", "Escape"]);
  });

  test("runs single keys and modifier keys, and says whether it handled the key", () => {
    const { keys, ran } = setup();
    expect([keys.handle({ key: "n" }), keys.handle({ key: "k", ctrlKey: true }), keys.handle({ key: "x" })]).toEqual([true, true, false]);
    expect(ran).toEqual(["n", "mod+k"]);
  });

  test("runs a chord, and a wrong second key cancels it", () => {
    const { keys, ran } = setup();
    expect([keys.handle({ key: "g" }), keys.handle({ key: "m" })]).toEqual([true, true]);
    keys.handle({ key: "g" });
    expect(keys.handle({ key: "x" })).toBe(false);
    for (const key of ["j", "g", "g", "m", "g", "j"]) keys.handle({ key });
    expect(ran).toEqual(["g m", "g j"]);
  });

  test("never fires a single key in a text field, but ⌘K still works there", () => {
    const { keys, ran } = setup();
    keys.handle({ key: "n", target: "field" });
    keys.handle({ key: "g" });
    keys.handle({ key: "m", target: "field" });
    keys.handle({ key: "k", metaKey: true, target: "field" });
    expect(ran).toEqual(["mod+k"]);
  });

  test("with single-key shortcuts off, no single key does anything and ⌘K still works", () => {
    const { keys, ran } = setup(false);
    const handled = ["n", "g", "m", "?", "t"].map((key) => keys.handle({ key }));
    handled.push(keys.handle({ key: "k", metaKey: true }));
    expect([handled, ran]).toEqual([[false, false, false, false, false, true], ["mod+k"]]);
  });

  test("ignores Alt, refuses a second registration, and frees a key on unregister", () => {
    const { keys, ran } = setup();
    expect(keys.handle({ key: "n", altKey: true })).toBe(false);
    expect(() => keys.register("n", () => {})).toThrow('shortcut "n" is already registered');
    const off = keys.register("t", () => ran.push("t"));
    off();
    expect(keys.handle({ key: "t" })).toBe(false);
    expect(() => keys.register("t", () => {})).not.toThrow();
  });

  test("J and K step through rows and stop at the ends", () => {
    expect([step(-1, 1, 3), step(0, 1, 3), step(2, 1, 3), step(-1, -1, 3), step(1, -1, 3), step(0, -1, 3)]).toEqual([0, 1, 2, 0, 0, 0]);
  });
});

describe("the command menu's matching", () => {
  const command = (group: Command["group"], label: string, hint: string): Command => ({ group, label, hint, run: () => {} });
  const all = [command("Printers", "Voron 2.4", "moonraker"), command("Actions", "Go to Jobs", "G J")];
  all.push(command("Jobs", "gridfinity 1a2b3c4d", "done"), command("Actions", "New print", "N"));

  test("groups results as Jobs, Actions, Printers, keeping their order", () => {
    expect(matchCommands(all, "").map((c) => c.label)).toEqual(["gridfinity 1a2b3c4d", "Go to Jobs", "New print", "Voron 2.4"]);
  });

  test("matches every word against the label and hint, ignoring case", () => {
    expect(matchCommands(all, "go JOBS").map((c) => c.label)).toEqual(["Go to Jobs"]);
    expect(matchCommands(all, "done").map((c) => c.label)).toEqual(["gridfinity 1a2b3c4d"]);
    expect(matchCommands(all, "nothing here")).toEqual([]);
  });
});
