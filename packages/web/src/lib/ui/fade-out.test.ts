import { afterEach, describe, expect, test } from "bun:test";
import { fadeOut } from "./behaviour";

const FIELDS = new Set(["input", "select", "textarea"]);

class Fake {
  attrs: Map<string, string>;
  kids: Fake[] = [];
  style = { cssText: "", background: "" };
  className = "";
  inert = false;
  ariaHidden: string | null = null;
  value = "";
  removed = false;
  ends: Promise<void>[] = [];

  constructor(
    readonly tag: string,
    attrs: Record<string, string> = {},
  ) {
    this.attrs = new Map(Object.entries(attrs));
  }

  copy(): Fake {
    const twin = this.tag === "input" ? new FakeInput(Object.fromEntries(this.attrs)) : this.bare();
    twin.kids = this.kids.map((kid) => kid.copy());
    return twin;
  }

  bare() {
    return new Fake(this.tag, Object.fromEntries(this.attrs));
  }

  all(): Fake[] {
    return this.kids.flatMap((kid) => [kid, ...kid.all()]);
  }

  querySelectorAll(selector: string) {
    if (selector === "[id]") return this.all().filter((el) => el.attrs.has("id"));
    return this.all().filter((el) => FIELDS.has(el.tag) && el.attrs.get("type") !== "file");
  }

  matches(_selector: string) {
    return false;
  }

  removeAttribute(name: string) {
    this.attrs.delete(name);
  }

  append(kid: Fake) {
    this.kids.push(kid);
  }

  remove() {
    this.removed = true;
  }

  getAnimations() {
    return this.ends.map((finished) => ({ finished }));
  }

  getBoundingClientRect() {
    return { top: 120, left: 500, width: 440, height: 660 };
  }
}

class FakeInput extends Fake {
  checked = false;

  constructor(attrs: Record<string, string> = {}) {
    super("input", attrs);
  }

  matches(selector: string) {
    return selector === ":checked" && this.checked;
  }
}

class FakeDialog extends Fake {
  constructor(attrs: Record<string, string> = {}) {
    super("dialog", attrs);
  }

  bare() {
    return new FakeDialog(Object.fromEntries(this.attrs));
  }

  cloneNode() {
    return this.copy();
  }
}

function setup(reduce: boolean, ends: Promise<void>[]) {
  const body = new Fake("body");
  const make = () => Object.assign(new Fake("div"), { ends });
  Object.assign(globalThis, {
    HTMLDialogElement: FakeDialog,
    matchMedia: () => ({ matches: reduce }),
    getComputedStyle: () => ({ backgroundColor: "backdrop-shade" }),
    document: { body, createElement: make },
  });
  const name = new FakeInput({ id: "name", type: "text" });
  name.value = "Ghost name";
  const tick = new FakeInput({ id: "only", type: "checkbox" });
  tick.checked = true;
  const software = new Fake("select", { id: "software" });
  software.value = "elegoo";
  const file = new FakeInput({ type: "file" });
  const dialog = new FakeDialog({ open: "", "aria-labelledby": "title" });
  dialog.kids = [new Fake("h2", { id: "title" }), name, tick, software, file];
  if (!(dialog instanceof HTMLDialogElement)) throw new Error("fake dialog not installed");
  return { body, dialog };
}

afterEach(() => {
  for (const key of ["HTMLDialogElement", "matchMedia", "getComputedStyle", "document"]) {
    Reflect.deleteProperty(globalThis, key);
  }
});

describe("a closing dialog's fading copy", () => {
  test("keeps what was typed and ticked, out of reach of keys, clicks and readers", () => {
    const { body, dialog } = setup(false, []);
    fadeOut(dialog);
    const [veil] = body.kids;
    const [copy] = veil?.kids ?? [];
    expect(veil?.className).toBe("veil");
    expect(veil?.inert).toBe(true);
    expect(veil?.ariaHidden).toBe("true");
    expect(veil?.style.background).toBe("backdrop-shade");
    expect(copy?.attrs.has("open")).toBe(false);
    expect(copy?.style.cssText).toBe("top:120px;left:500px;width:440px;height:660px");
    const [title, name, tick, software, file] = copy?.kids ?? [];
    expect(name?.value).toBe("Ghost name");
    expect(tick?.matches(":checked")).toBe(true);
    expect(software?.value).toBe("elegoo");
    expect(file?.value).toBe("");
    expect([title, name, tick, software].some((el) => el?.attrs.has("id"))).toBe(false);
    expect(dialog.kids[1]?.attrs.get("id")).toBe("name");
  });

  test("is removed once its fade ends", async () => {
    const end = Promise.withResolvers<void>();
    const { body, dialog } = setup(false, [end.promise]);
    fadeOut(dialog);
    await Promise.resolve();
    expect(body.kids[0]?.removed).toBe(false);
    end.resolve();
    await end.promise;
    await new Promise((done) => setTimeout(done, 0));
    expect(body.kids[0]?.removed).toBe(true);
  });

  test("is removed when its fade is cancelled, as a navigation does", async () => {
    const end = Promise.withResolvers<void>();
    const { body, dialog } = setup(false, [end.promise]);
    fadeOut(dialog);
    end.reject(new Error("AbortError"));
    await new Promise((done) => setTimeout(done, 0));
    expect(body.kids[0]?.removed).toBe(true);
  });

  test("is never made under reduced motion", () => {
    const { body, dialog } = setup(true, []);
    fadeOut(dialog);
    expect(body.kids).toEqual([]);
  });
});
