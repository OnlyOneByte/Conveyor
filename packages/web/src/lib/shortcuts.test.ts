import { describe, expect, test } from "bun:test";
import { type Command, matchCommands } from "./commands";
import { CHORD_MS, createShortcuts, inTextField, keyName, step } from "./shortcuts";

const setup = (singleKeys = true) => {
  const ran: string[] = [];
  const keys = createShortcuts({
    singleKeys: () => singleKeys,
    inField: (target) => target === "field",
  });
  for (const k of ["mod+k", "n", "g m", "g j", "?"]) keys.register(k, () => ran.push(k));
  return { keys, ran };
};

describe("the shortcut registry", () => {
  test("names keys with mod+ for ⌘ or Ctrl, and lower-cases single letters", () => {
    const names = [
      { key: "k", metaKey: true },
      { key: "K", ctrlKey: true },
      { key: "N" },
      { key: "?" },
      { key: "Escape" },
    ].map(keyName);
    expect(names).toEqual(["mod+k", "mod+k", "n", "?", "Escape"]);
  });

  test("runs single keys and modifier keys, and says whether it handled the key", () => {
    const { keys, ran } = setup();
    expect([
      keys.handle({ key: "n" }),
      keys.handle({ key: "k", ctrlKey: true }),
      keys.handle({ key: "x" }),
    ]).toEqual([true, true, false]);
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
    for (const input of [
      { key: "n", target: "field" },
      { key: "g" },
      { key: "m", target: "field" },
      { key: "k", metaKey: true, target: "field" },
    ])
      keys.handle(input);
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
    keys.register("t", () => ran.push("t"))();
    expect(keys.handle({ key: "t" })).toBe(false);
    expect(() => keys.register("t", () => {})).not.toThrow();
  });

  test("Shift with a letter is its own key, so Shift+N doesn't run N, and ? still works", () => {
    const { keys, ran } = setup();
    expect([
      keyName({ key: "N", shiftKey: true }),
      keys.handle({ key: "N", shiftKey: true }),
      keys.handle({ key: "?", shiftKey: true }),
    ]).toEqual(["shift+n", false, true]);
    expect(ran).toEqual(["?"]);
  });

  test("a pending G times out after CHORD_MS", () => {
    let at = 0;
    const ran: string[] = [];
    const keys = createShortcuts({ inField: () => false, now: () => at });
    for (const k of ["g m", "m"]) keys.register(k, () => ran.push(k));
    const press = (key: string, time: number) => {
      at = time;
      keys.handle({ key });
    };
    for (const [key, time] of [
      ["g", 0],
      ["m", CHORD_MS],
      ["g", CHORD_MS],
      ["m", 2 * CHORD_MS + 1],
    ] as const)
      press(key, time);
    expect(ran).toEqual(["g m", "m"]);
  });

  test("the real field guard covers input, textarea, select and contenteditable", () => {
    class FakeElement {
      constructor(
        readonly tag: string,
        readonly editable = false,
      ) {}
      matches = (selector: string) =>
        selector
          .split(", ")
          .some(
            (part) => part === this.tag || (this.editable && part.startsWith("[contenteditable]")),
          );
    }
    Object.assign(globalThis, { Element: FakeElement });
    try {
      const targets = ["input", "textarea", "select", "button", "a"].map(
        (tag) => new FakeElement(tag),
      );
      expect([...targets, new FakeElement("div", true), "input", null].map(inTextField)).toEqual([
        true,
        true,
        true,
        false,
        false,
        true,
        false,
        false,
      ]);
    } finally {
      Reflect.deleteProperty(globalThis, "Element");
    }
  });

  test("J and K step through rows and stop at the ends", () => {
    expect([
      step(-1, 1, 3),
      step(0, 1, 3),
      step(2, 1, 3),
      step(-1, -1, 3),
      step(1, -1, 3),
      step(0, -1, 3),
    ]).toEqual([0, 1, 2, 0, 0, 0]);
  });
});

describe("the command menu's matching", () => {
  const command = (group: Command["group"], label: string, hint: string): Command => ({
    group,
    label,
    hint,
    run: () => {},
  });
  const all = [
    command("Printers", "Voron 2.4", "moonraker"),
    command("Actions", "Go to Jobs", "G J"),
  ];
  all.push(command("Jobs", "gridfinity 1a2b3c4d", "done"), command("Actions", "New print", "N"));

  test("groups results as Jobs, Actions, Printers, keeping their order", () => {
    expect(matchCommands(all, "").map((c) => c.label)).toEqual([
      "gridfinity 1a2b3c4d",
      "Go to Jobs",
      "New print",
      "Voron 2.4",
    ]);
  });

  test("matches every word against the label and hint, ignoring case", () => {
    expect(matchCommands(all, "go JOBS").map((c) => c.label)).toEqual(["Go to Jobs"]);
    expect(matchCommands(all, "done").map((c) => c.label)).toEqual(["gridfinity 1a2b3c4d"]);
    expect(matchCommands(all, "nothing here")).toEqual([]);
  });
});
