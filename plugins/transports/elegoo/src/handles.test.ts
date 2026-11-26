import { describe, expect, test } from "bun:test";
import { elegoo } from "./index";

describe("elegoo handles", () => {
  test("handleFor carries the stored mainboard id", () => {
    const built = elegoo.handleFor?.(
      {
        id: "conveyor-printer-1",
        transportId: "elegoo",
        address: "10.0.0.8",
        secrets: { mainboardId: "mainboard-abc" },
      },
      "a.gcode",
    );
    expect(built?.deviceId).toBe("mainboard-abc");
    expect(built?.address).toBe("10.0.0.8");
  });
});
