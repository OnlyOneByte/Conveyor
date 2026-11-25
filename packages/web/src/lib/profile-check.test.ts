import { expect, describe as group, test } from "bun:test";
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
