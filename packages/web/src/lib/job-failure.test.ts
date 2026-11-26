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
const PRUSA_292_OUTSIDE =
  "prusa-slicer exited 0 but wrote no G-code: All objects are outside of the print volume.";

describe("failureText", () => {
  test("reads the slicers' out-of-bed errors as a model that doesn't fit", () => {
    for (const reason of [ORCA_EMPTY, ORCA_PARTLY, PRUSA_EMPTY, PRUSA_292_OUTSIDE]) {
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

test("a print start the printer never answered says it may have started, before any retry", () => {
  const reason = "moonraker gave no answer to print start within 30000 ms";
  expect(failureText("transport", reason)).toEqual({
    title: "Sending to the printer didn't finish",
    detail:
      "The printer didn't answer the print start, so it may have started. Conveyor has put it on hold: check it, then choose Release hold on the Printers page before you retry.",
  });
});

test.each([
  [
    "printer is busy: moonraker reports it printing",
    "The printer is busy with another print. Wait for it to finish, then retry.",
  ],
  [
    "printer is busy: elegoo reports it paused",
    "The printer is busy with another print. Wait for it to finish, then retry.",
  ],
  [
    "printer reports an error: elegoo says error",
    "The printer reports an error. Clear it on the printer, then retry.",
  ],
  [
    "moonraker idle check failed: Unable to connect",
    "Conveyor couldn't check that the printer is free, so it didn't send the job. Check that the printer is on and connected, then retry.",
  ],
  [
    "elegoo idle check from 10.0.0.8: no status within 15000 ms",
    "Conveyor couldn't check that the printer is free, so it didn't send the job. Check that the printer is on and connected, then retry.",
  ],
  [
    "printer state unknown: moonraker gave no usable state",
    "Conveyor couldn't check that the printer is free, so it didn't send the job. Check that the printer is on and connected, then retry.",
  ],
])("a refused upload (%s) says why in plain words", (reason, detail) => {
  expect(failureText("transport", reason).detail).toBe(detail);
});

test("a printer on hold says to check it and release the hold", () => {
  expect(failureText("transport", "printer is on hold: moonraker gave no answer").detail).toBe(
    "The printer is on hold until someone checks it. Check the printer, then choose Release hold on the Printers page and retry.",
  );
});
