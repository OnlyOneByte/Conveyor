import { describe, expect, test } from "bun:test";
import { NOTE } from "@conveyor/shared/job-notes";
import { plainNote, readNote, SAID } from "./job-notes.js";

describe("job notes", () => {
  test("every note the worker writes maps to its own sentence, never the fallback", () => {
    const sentences = Object.entries(NOTE).map(([kind, prefix]) => {
      const note = readNote(`${prefix}: EBUSY /data/jobs/z`);
      expect(note?.raw).toBe(`${prefix}: EBUSY /data/jobs/z`);
      expect(note?.plain).toEqual([Object.entries(SAID).find(([k]) => k === kind)?.[1] ?? ""]);
      return note?.plain[0];
    });
    expect(new Set(sentences).size).toBe(Object.keys(NOTE).length);
    expect(sentences).not.toContain("Conveyor noted something else about this job.");
  });

  test("worker notes read in plain words, with the raw text kept for Details", () => {
    const raw =
      "status stream did not close cleanly: socket hang up; work dir not removed: EBUSY: /data/jobs/x";
    expect(readNote(raw)).toEqual({
      plain: [
        "The printer's status updates didn't end cleanly.",
        "This job's working files weren't cleaned up.",
      ],
      raw,
    });
  });

  test("a '; ' inside a worker message doesn't split it", () => {
    const raw = "filament use not read: bad header; line 3; canceled on printer";
    expect(readNote(raw)?.plain).toEqual([
      "Conveyor couldn't read how much filament this used.",
      "It was canceled on the printer.",
    ]);
  });

  test("an unknown part next to a known one is summarised, never shown raw", () => {
    const raw = "no stored print handle; work dir not removed: EBUSY /data/jobs/y";
    const note = readNote(raw);
    expect(note?.plain).toEqual([
      "Conveyor noted something else about this job.",
      "This job's working files weren't cleaned up.",
    ]);
    expect(note?.plain.join(" ")).not.toContain("/data");
  });

  test("a note Conveyor didn't write is shown as it is, with no Details", () => {
    expect(readNote("  Printed with the blue spool  ")).toEqual({
      plain: ["Printed with the blue spool"],
      raw: null,
    });
    expect(readNote("   ")).toBeNull();
    expect(readNote(undefined)).toBeNull();
    expect(plainNote(undefined)).toBe("");
  });

  test("every cancel note the worker writes has its own sentence", () => {
    expect(plainNote("cancel requested but transport elegoo cannot stop a print")).toBe(
      "This printer can't be stopped from Conveyor. Stop it on the printer.",
    );
    expect(plainNote("cancel requested but the printer did not confirm the stop: 500")).toBe(
      "The printer didn't confirm it stopped. Check the printer.",
    );
  });
});
