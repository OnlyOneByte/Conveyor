import { describe, expect, test } from "bun:test";
import { failureText } from "./job-failure.js";

const TOO_BIG =
  "The model doesn't fit the printer's bed. Make it smaller, or pick a bigger printer.";
const UNREACHABLE =
  "Conveyor couldn't reach the printer. Check that it's on and connected, then retry.";

const ORCA_EMPTY =
  "xvfb-run exited 1: model.stl: Nothing to be sliced, Either the print is empty or no object " +
  "is fully inside the print volume before apply.";
const ORCA_PARTLY = "xvfb-run exited 1: Found Object model.stl partly inside, can not be sliced.";
const PRUSA_EMPTY =
  "prusa-slicer exited 1: Nothing to print for model.gcode . Either the print is empty or no " +
  "object is fully inside the print volume.";

describe("failureText", () => {
  test("reads the slicers' out-of-bed errors as a model that doesn't fit", () => {
    for (const reason of [ORCA_EMPTY, ORCA_PARTLY, PRUSA_EMPTY]) {
      expect(failureText("slicer", reason)).toEqual({
        title: "Slicing didn't finish",
        detail: TOO_BIG,
      });
    }
  });

  test("reads the transports' connection errors as an unreachable printer", () => {
    const reasons = [
      "moonraker upload failed: Unable to connect. Is the computer able to access the url?",
      "moonraker status query failed: The operation timed out.",
      "elegoo cmd 128 timed out",
      "elegoo WS error to 192.0.2.10:3030",
    ];
    for (const reason of reasons) {
      expect(failureText("transport", reason).detail).toBe(UNREACHABLE);
    }
  });

  test("reads a missing upload as a file to upload again", () => {
    const reason = "upload not found: 3f2c9a7e-0b1d-4c55-9e61-2f6a1d0c8b41";
    expect(failureText("generator", reason)).toEqual({
      title: "Making the model didn't finish",
      detail: "The uploaded file is gone. Upload it again to print it.",
    });
  });

  test("never repeats the raw reason, even for an unknown one", () => {
    const { title, detail } = failureText("generator", "spawn openscad ENOENT 3f2c9a7e-0b1d");
    expect(`${title} ${detail}`).not.toContain("ENOENT");
    expect(`${title} ${detail}`).not.toContain("3f2c9a7e");
  });

  test("names only the stages it knows, never an inherited key", () => {
    for (const stage of ["unknown", "toString", "constructor", "__proto__"]) {
      expect(failureText(stage, "boom").title).toBe("This job didn't finish");
    }
  });
});
