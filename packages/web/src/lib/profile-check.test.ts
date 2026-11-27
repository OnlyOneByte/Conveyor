import { expect, describe as group, test } from "bun:test";
import { parser } from "@lezer/json";
import { describe, orcaProblem, prusaProblem } from "./profile-check.js";

const good = {
  machine: '{"type": "machine"}',
  process: '{\n  "layer_height": "0.2"\n}',
  filament: "{}",
};

group("orcaProblem", () => {
  test("passes documents the API accepts", () => {
    expect(orcaProblem(good)).toBeNull();
  });

  test("puts a missing comma on the line after it, in the file it is in", () => {
    const process = '{\n  "type": "process",\n  "wall_loops": "3"\n  "layer_height": "0.2"\n}';
    const problem = orcaProblem({ ...good, process });
    expect(problem && { file: problem.file, line: problem.line }).toEqual({
      file: "process",
      line: 4,
    });
    expect(problem && describe(problem)).toStartWith("Process, line 4: this isn't valid JSON.");
  });

  test("finds an unclosed document at its end", () => {
    expect(orcaProblem({ ...good, filament: '{\n  "a": 1,\n' })?.line).toBe(3);
  });

  const lezerLine = (text: string) => {
    let at: number | null = null;
    parser.parse(text).iterate({
      enter: (node) => {
        if (node.type.isError) at ??= node.from;
        return at === null;
      },
    });
    return at === null ? null : text.slice(0, at).split("\n").length;
  };

  test.each([
    '{\n  "a": 1,\n  "b": 2,\n}',
    '{\n  "a": [1, 2\n  "b": 3\n}',
    '{\n  "a": tru\n}',
    '{\n  "a" 1\n}',
    "{\n  a: 1\n}",
    '{\n  "a": {"b": [true, null, -1.5e3]}\n}\n}',
    '{\n  "a": 1,\n  "b": 2,\n  "c": 3,\n  "d": 4,\n  "e": 5,\n  "f": "\\x",\n  "g": 7\n}',
    '{\n  "path": "C:\\Users\\me\\bin",\n  "b": 2\n}',
    '{\n  "a": "tab\there",\n  "b": 2\n}',
    '{\n  "a": "\\u12G4",\n  "b": 2\n}',
  ])("puts the error on the line the editor's JSON parser does: %j", (filament) => {
    expect(orcaProblem({ ...good, filament })?.line).toBe(lezerLine(filament) ?? -1);
  });

  test("agrees with the editor's JSON parser on 600 one-character mutations", () => {
    const base = JSON.stringify(
      { type: "filament", name: 'PLA "basic" \\ 1', temps: [210, 60], ratio: -1.5e3, on: true },
      null,
      2,
    );
    const alphabet = '{}[]:,"\\ \t\nabcxu019.-eE';
    let seed = 653;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed;
    };
    const misses: string[] = [];
    for (let i = 0; i < 600; i++) {
      const at = next() % base.length;
      const char = alphabet[next() % alphabet.length] ?? "";
      const filament = base.slice(0, at) + char + base.slice(at + (next() % 2));
      const want = lezerLine(filament);
      const got = orcaProblem({ ...good, filament });
      const line = got?.text.includes("valid JSON") ? got.line : null;
      if (line !== want) misses.push(JSON.stringify(filament));
    }
    expect(misses).toEqual([]);
  });

  test("passes nested JSON and survives deep nesting", () => {
    const nested = '{"a": {"b": [1, {"c": "d\\"e"}]}}';
    expect(orcaProblem({ ...good, filament: nested })?.text).not.toContain("valid JSON");
    const deep = `{"a": ${"[".repeat(200_000)}${"]".repeat(200_000)}}`;
    expect(orcaProblem({ ...good, filament: deep })?.text).not.toContain("valid JSON");
  });

  test("names a setting the API refuses, on its own line", () => {
    const machine = '{\n  "type": "machine",\n  "post_process": "rm -rf"\n}';
    expect(orcaProblem({ ...good, machine })).toEqual({
      file: "machine",
      line: 3,
      text: `Conveyor doesn't allow the setting "post_process".`,
    });
  });

  test("points a wrong type at its key, and a bare value at line 1", () => {
    const filament = '{\n\n  "type": "process"\n}';
    expect(orcaProblem({ ...good, filament })).toEqual({
      file: "filament",
      line: 3,
      text: `"type" must be "filament".`,
    });
    expect(orcaProblem({ ...good, machine: "[]" })?.text).toBe(
      "the file must be one JSON object, inside { }.",
    );
  });
});

group("prusaProblem", () => {
  test("passes a config the API accepts", () => {
    expect(prusaProblem("# comment\n[print]\nlayer_height = 0.2\n")).toBeNull();
  });

  test("reports the line that is not a setting", () => {
    expect(prusaProblem("layer_height = 0.2\nperimeters 3\n")).toEqual({
      file: "config",
      line: 2,
      text: "each line must be a setting like key = value.",
    });
  });

  test("finds a refused setting and an empty file", () => {
    expect(prusaProblem("layer_height = 0.2\n  post_process = x\n")?.line).toBe(2);
    expect(prusaProblem("# nothing\n")?.text).toBe("add at least one setting like key = value.");
  });
});
