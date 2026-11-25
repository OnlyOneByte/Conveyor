import { describe, expect, test } from "bun:test";
import type { CatalogProfile } from "./api.js";
import { orcaProblem, prusaProblem } from "./profile-check.js";
import { gate, loadContent } from "./profile-content.js";

const added = (slicerId: string): CatalogProfile => ({
  id: `${slicerId}/voron-petg-0-25mm`,
  slicerId,
  name: "Voron PETG 0.25mm",
  path: "/profiles/voron-petg-0-25mm",
  gcodeFlavor: "klipper",
  bundled: false,
});

const answering = (status: number, body: unknown) =>
  Object.assign(async () => Response.json(body, { status }), { preconnect: fetch.preconnect });

describe("loadContent", () => {
  test("opens a profile whose folder has no files as empty files, not a failure", async () => {
    const missing = answering(404, { error: "bundled profile directory is unavailable" });
    expect(await loadContent(added("orca"), missing)).toEqual({
      files: ["machine", "process", "filament"],
      lang: "json",
      docs: { machine: "", process: "", filament: "" },
      edited: false,
      missing: true,
    });
    expect(await loadContent(added("prusa"), missing)).toEqual({
      files: ["config"],
      lang: "ini",
      docs: { config: "" },
      edited: false,
      missing: true,
    });
  });

  test("still fails on any other error, with the server's message", async () => {
    const broken = answering(409, { error: "bundled machine.json has type process" });
    await expect(loadContent(added("orca"), broken)).rejects.toThrow("has type process");
  });

  test("reads saved files as present", async () => {
    const documents = { machine: "{}", process: "{}", filament: "{}" };
    const saved = answering(200, { format: "orca-json", source: "edited", documents });
    const content = await loadContent(added("orca"), saved);
    expect(content && { edited: content.edited, missing: content.missing }).toEqual({
      edited: true,
      missing: false,
    });
  });
});

describe("an empty file", () => {
  test("asks for the slicer's settings instead of calling it invalid JSON", () => {
    const empty = orcaProblem({ machine: "", process: "{}", filament: "{}" });
    expect(empty).toEqual({
      file: "machine",
      line: 1,
      text: "this file is empty. Paste the settings your slicer exported for it.",
    });
    expect(prusaProblem("")?.text).toBe("add at least one setting like key = value.");
  });
});

describe("the editor's actions", () => {
  const ready = { ready: true, problem: false, dirty: true, busy: false, tidied: true };

  test("all run once the editor is mounted and the text is valid and changed", () => {
    expect(gate(ready)).toEqual({ save: true, tidy: true, reset: true });
  });

  test("none run before the editor mounts, even with changed text", () => {
    expect(gate({ ...ready, ready: false })).toEqual({ save: false, tidy: false, reset: false });
  });

  test("Save waits for valid, changed text and an idle editor; Reset only for idle", () => {
    expect(gate({ ...ready, problem: true }).save).toBe(false);
    expect(gate({ ...ready, dirty: false }).save).toBe(false);
    expect(gate({ ...ready, busy: true })).toEqual({ save: false, tidy: true, reset: false });
    expect(gate({ ...ready, tidied: false }).tidy).toBe(false);
  });
});
