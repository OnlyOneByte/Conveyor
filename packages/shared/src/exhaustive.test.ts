import { describe, expect, test } from "bun:test";
import { exhaustive } from "./exhaustive";

type Light = "red" | "green";

function describeLight(light: Light): string {
  switch (light) {
    case "red":
      return "stop";
    case "green":
      return "go";
    default:
      return exhaustive(light);
  }
}

describe("exhaustive", () => {
  test("a switch that covers every member never reaches it", () => {
    expect(describeLight("red")).toBe("stop");
    expect(describeLight("green")).toBe("go");
  });

  test("a value outside the union throws and names the value", () => {
    expect(() => Reflect.apply(describeLight, undefined, ["amber"])).toThrow(
      'unhandled value: "amber"',
    );
  });
});
