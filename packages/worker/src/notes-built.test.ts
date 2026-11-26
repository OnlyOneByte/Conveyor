import { describe, expect, test } from "bun:test";
import { type NoteText, note, notesText, noteText } from "@conveyor/shared";
import type { TerminalRecord } from "./run.js";

type Takes<Field, Value> = [Value] extends [Field] ? true : false;

const stringIsRefused: Takes<TerminalRecord["notes"], string> = false;
const builtIsTaken: Takes<TerminalRecord["notes"], NoteText> = true;

describe("a stored job note is only ever built text", () => {
  test("the record's notes field refuses a plain string and takes built text", () => {
    expect([stringIsRefused, builtIsTaken]).toEqual([false, true]);
  });

  test("built text joins notes in order and leaves an empty list unset", () => {
    const record: TerminalRecord = {
      state: "failed",
      notes: notesText([note("resumeNoHandle"), note("workDirNotRemoved", "EBUSY")]),
    };
    expect(String(record.notes)).toBe(
      "resume failed: no stored print handle; work dir not removed: EBUSY",
    );
    expect(notesText([])).toBeUndefined();
    expect(String(noteText(note("canceledOnPrinter")))).toBe("canceled on printer");
  });
});
