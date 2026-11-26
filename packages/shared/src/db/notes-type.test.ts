import { describe, expect, test } from "bun:test";
import type { NoteText } from "../job-notes.js";
import type { SettledJob } from "./jobs.js";

type Takes<Field, Value> = [Value] extends [Field] ? true : false;

const stringIsRefused: Takes<SettledJob["notes"], string> = false;
const builtIsTaken: Takes<SettledJob["notes"], NoteText> = true;

describe("the database writer's notes", () => {
  test("refuse a plain string and take built note text", () => {
    expect([stringIsRefused, builtIsTaken]).toEqual([false, true]);
  });
});
