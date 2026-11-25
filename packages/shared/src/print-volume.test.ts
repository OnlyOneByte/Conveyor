import { describe, expect, test } from "bun:test";
import { orcaPrintVolume, prusaPrintVolume } from "./print-volume.js";

describe("print volume", () => {
  test("reads an Orca machine's printable area and height", () => {
    const machine = JSON.stringify({
      printable_area: ["0x0", "220x0", "220x220", "0x220"],
      printable_height: "250",
    });
    expect(orcaPrintVolume(machine)).toEqual({ x: 220, y: 220, z: 250 });
    const offset = JSON.stringify({
      printable_area: ["-5x-2.5", "245x-2.5", "245x207.5", "-5x207.5"],
      printable_height: 210,
    });
    expect(orcaPrintVolume(offset)).toEqual({ x: 250, y: 210, z: 210 });
  });

  test("reads a Prusa bed shape and max print height", () => {
    const config =
      "layer_height = 0.2\nbed_shape = 0x0,250x0,250x210,0x210\nmax_print_height = 220\n";
    expect(prusaPrintVolume(config)).toEqual({ x: 250, y: 210, z: 220 });
  });

  test("says nothing rather than guess when a profile is missing or malformed", () => {
    expect(orcaPrintVolume(JSON.stringify({ inherits: "fdm_common" }))).toBeNull();
    expect(orcaPrintVolume("{not json")).toBeNull();
    expect(
      orcaPrintVolume(JSON.stringify({ printable_area: ["0x0", "nope"], printable_height: "250" })),
    ).toBeNull();
    expect(
      orcaPrintVolume(
        JSON.stringify({ printable_area: ["0x0", "1x0", "1x1"], printable_height: "0" }),
      ),
    ).toBeNull();
    expect(prusaPrintVolume("bed_shape = 0x0,0x0,0x0\nmax_print_height = 200")).toBeNull();
    expect(prusaPrintVolume("layer_height = 0.2")).toBeNull();
  });
});
