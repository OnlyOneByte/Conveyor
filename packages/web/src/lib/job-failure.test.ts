import { describe, expect, test } from "bun:test";
import { failureText } from "./job-failure.js";

describe("failureText", () => {
  test("names the step and explains a known reason in plain words", () => {
    expect(failureText("slicer", "slicer: exit 1: Objects could not fit on the bed")).toEqual({
      title: "Slicing didn't finish",
      detail:
        "The model is bigger than the printer's bed. Make it smaller, or pick a bigger printer.",
    });
    expect(failureText("transport", "connect ECONNREFUSED 192.0.2.10:7125").detail).toBe(
      "Conveyor couldn't reach the printer. Check that it's on and connected, then retry.",
    );
  });

  test("never repeats the raw reason, even for an unknown one", () => {
    const reason = "spawn openscad ENOENT 3f2c9a7e-0b1d-4c55-9e61-2f6a1d0c8b41";
    const text = failureText("generator", reason);
    expect(text.title).toBe("Making the model didn't finish");
    expect(`${text.title} ${text.detail}`).not.toContain("ENOENT");
    expect(`${text.title} ${text.detail}`).not.toContain("3f2c9a7e");
  });

  test("falls back to a generic step name", () => {
    expect(failureText("unknown", "boom").title).toBe("This job didn't finish");
  });
});
