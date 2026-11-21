import { describe, expect, test } from "bun:test";
import { DENIED_KEY } from "./slicer-key-policy";
import { ORCA_CONFIG_KEYS, PRUSA_CONFIG_KEYS, toKeySet } from "./slicer-keys";

describe("slicer key data", () => {
  test.each([
    ["prusa", PRUSA_CONFIG_KEYS],
    ["orca", ORCA_CONFIG_KEYS],
  ])("%s loads with no denied keys", (_name, keys) => {
    expect(keys.size).toBeGreaterThan(100);
    expect([...keys].filter((key) => DENIED_KEY.test(key))).toEqual([]);
  });

  test.each([
    ["not an array", {}],
    ["empty", []],
    ["a non-string entry", ["layer_height", 1]],
    ["a malformed key", ["layer height"]],
    ["a denied key", ["layer_height", "post_process"]],
  ])("rejects %s", (_label, value) => {
    expect(() => toKeySet("test", value)).toThrow();
  });
});
