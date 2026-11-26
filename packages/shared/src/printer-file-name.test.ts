import { describe, expect, test } from "bun:test";
import { filesToPrune, printerFileName } from "./context";

test("a printer file is named after its job, so two jobs never share a file", () => {
  expect(printerFileName("0f2c9a8e-1b2c-4d5e-8f90-123456789abc")).toBe(
    "conveyor-0f2c9a8e-1b2c-4d5e-8f90-123456789abc.gcode",
  );
  expect(printerFileName("a1")).not.toBe(printerFileName("b2"));
});

test("anything but letters, digits and dashes in a job id becomes an underscore", () => {
  expect(printerFileName("../x y/é")).toBe("conveyor-___x_y__.gcode");
});

describe("filesToPrune", () => {
  const keep = new Set(["conveyor-c3.gcode"]);

  test("picks Conveyor's own files that are neither kept nor printing", () => {
    const paths = ["conveyor-a1.gcode", "conveyor-b2.gcode", "conveyor-c3.gcode"];
    expect(filesToPrune(paths, keep, "conveyor-b2.gcode")).toEqual(["conveyor-a1.gcode"]);
  });

  test("never picks a file whose name Conveyor didn't give it", () => {
    const paths = [
      "benchy.gcode",
      "conveyor-a1.gcode.bak",
      "my-conveyor-a1.gcode",
      "conveyor-a1.GCODE",
      "conveyor-.gcode",
      "conveyor-a 1.gcode",
      "conveyor-a1.gcode/",
    ];
    expect(filesToPrune(paths, keep, undefined)).toEqual([]);
  });

  test("matches by file name, so a listed path and a printing path compare alike", () => {
    const paths = ["/local/conveyor-a1.gcode", "/local/conveyor-b2.gcode"];
    expect(filesToPrune(paths, keep, "conveyor-a1.gcode")).toEqual(["/local/conveyor-b2.gcode"]);
    expect(filesToPrune(paths, new Set(["conveyor-b2.gcode"]), "/local/conveyor-a1.gcode")).toEqual(
      [],
    );
  });
});
