import { describe, expect, test } from "bun:test";
import { secretFieldFor, secretsPatch } from "./printer-secrets.ts";

describe("printer secret field", () => {
  test("an Elegoo printer saves its mainboard id as plain text", () => {
    expect(secretFieldFor("elegoo")).toMatchObject({
      key: "mainboardId",
      label: "Mainboard ID",
      hidden: false,
    });
    expect(secretsPatch("elegoo", "  7f3a0c  ")).toEqual({ secrets: { mainboardId: "7f3a0c" } });
  });

  test("any other transport saves a hidden API key", () => {
    expect(secretFieldFor("moonraker")).toMatchObject({ key: "apiKey", hidden: true });
    expect(secretsPatch("moonraker", "hunter2")).toEqual({ secrets: { apiKey: "hunter2" } });
  });

  test("a blank field sends no secrets, so the stored ones are kept", () => {
    expect(secretsPatch("elegoo", "   ")).toEqual({});
    expect(secretsPatch("moonraker", "")).toEqual({});
  });
});
