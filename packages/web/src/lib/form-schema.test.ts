import { describe, expect, test } from "bun:test";
import { type JsonSchemaProp, settledValue, typedValue } from "./form-schema";

const integer: JsonSchemaProp = { type: "integer", minimum: 1, maximum: 6 };
const decimal: JsonSchemaProp = { type: "number", minimum: 0, maximum: 1 };

describe("a number typed into a stepper", () => {
  test("commits only a legal value, truncating integers", () => {
    expect(typedValue(integer, "4.7")).toBe(4);
    expect(typedValue(decimal, "0.5")).toBe(0.5);
    expect(typedValue(integer, "")).toBeUndefined();
    expect(typedValue(integer, "abc")).toBeUndefined();
    expect(typedValue(integer, "9")).toBeUndefined();
  });

  test("settles to the current value when blank or not a number, and clamps", () => {
    expect(settledValue(integer, " ", 3)).toBe(3);
    expect(settledValue(integer, "abc", 3)).toBe(3);
    expect(settledValue(integer, "9", 3)).toBe(6);
    expect(settledValue(integer, " 2.9 ", 3)).toBe(2);
    expect(settledValue(decimal, "-1", 0.5)).toBe(0);
  });
});
