import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseFilamentUse, readFilamentUse } from "./filament.ts";

const fixture = (name: string) =>
  readFileSync(join(import.meta.dir, "../../test/fixtures/gcode", name), "utf8");
const prusa = fixture("prusaslicer-footer.gcode");
const orca = fixture("orcaslicer-header.gcode");

const dir = mkdtempSync(join(tmpdir(), "conveyor-filament-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("filament use from slicer output", () => {
  test("reads PrusaSlicer's footer in grams and metres", () => {
    expect(parseFilamentUse(prusa)).toEqual({ grams: 3.08, metres: 1.032 });
  });

  test("reads OrcaSlicer's header block", () => {
    expect(parseFilamentUse(orca)).toEqual({ grams: 6.59, metres: 2.21 });
  });

  test("adds up every extruder and prefers the total weight line", () => {
    const text = "; filament used [mm] = 1000.4, 250.2\r\n; filament used [g] = 2.5, 0.6\r\n";
    expect(parseFilamentUse(text)).toEqual({ grams: 3.1, metres: 1.251 });
    expect(parseFilamentUse(`${text}; total filament used [g] = 3.2\n`)?.grams).toBe(3.2);
  });

  test("leaves out a weight of zero, which is what a slicer writes without a density", () => {
    expect(parseFilamentUse("; filament used [mm] = 812.0\n; filament used [g] = 0.00\n")).toEqual({
      metres: 0.812,
    });
  });

  test.each([
    ["G-code without a header", "G28\nG1 X10\n"],
    ["an unreadable number", "; filament used [mm] = lots\n; filament used [g] = -2\n"],
    ["an empty extruder value", "; filament used [mm] = 100, \n"],
    ["an extruder with a negative value", "; filament used [g] = 5, -2\n"],
    ["a line that is not a comment", "G1 ; filament used [mm] = 100\nM117 filament used [g] = 3\n"],
  ])("knows nothing from %s", (_, text) => {
    expect(parseFilamentUse(text)).toBeUndefined();
  });

  test("reads the head and tail of a large file without the middle", async () => {
    const path = join(dir, "large.gcode");
    const middle = "G1 X1 Y1 E0.1\n".repeat(60_000);
    writeFileSync(path, `${orca}${middle}; filament used [g] = 1.25\n; filament used [mm] = 400\n`);
    expect(await readFilamentUse(path)).toEqual({ grams: 1.25, metres: 0.4 });
    const headOnly = join(dir, "head-only.gcode");
    writeFileSync(headOnly, `${orca}${middle}`);
    expect(await readFilamentUse(headOnly)).toEqual({ grams: 6.59, metres: 2.21 });
    const buried = join(dir, "buried.gcode");
    writeFileSync(buried, `${middle}; filament used [g] = 9\n${middle}`);
    expect(await readFilamentUse(buried)).toBeUndefined();
  });

  test("reads a small file whole", async () => {
    const path = join(dir, "small.gcode");
    writeFileSync(path, prusa);
    expect(await readFilamentUse(path)).toEqual({ grams: 3.08, metres: 1.032 });
  });
});
