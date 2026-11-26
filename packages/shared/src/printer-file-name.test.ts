import { expect, test } from "bun:test";
import { printerFileName } from "./context";

test("a printer file is named after its job, so two jobs never share a file", () => {
  expect(printerFileName("0f2c9a8e-1b2c-4d5e-8f90-123456789abc")).toBe(
    "conveyor-0f2c9a8e-1b2c-4d5e-8f90-123456789abc.gcode",
  );
  expect(printerFileName("a1")).not.toBe(printerFileName("b2"));
});

test("anything but letters, digits and dashes in a job id becomes an underscore", () => {
  expect(printerFileName("../x y/é")).toBe("conveyor-___x_y__.gcode");
});
