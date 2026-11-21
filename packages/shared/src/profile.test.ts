import { describe, expect, test } from "bun:test";
import { PrusaProfileValidationError, validatePrusaProfileContent } from "./profile";

const validate = (config: string) => () => validatePrusaProfileContent({ config });

describe("validatePrusaProfileContent", () => {
  test("accepts tab, LF and CRLF", () => {
    expect(validate("layer_height = 0.2\r\nfill\t= 15%\n")).not.toThrow();
  });

  test.each(["\x00", "\x08", "\x0b", "\x0c", "\x0e", "\x1f"])("rejects control char %p", (c) => {
    expect(validate(`layer_height = 0.2${c}\n`)).toThrow(PrusaProfileValidationError);
  });

  test("allows DEL and non-ASCII", () => {
    expect(validate("name = café\x7f\n")).not.toThrow();
  });

  test("requires at least one key = value line", () => {
    expect(validate("# only a comment\n[section]\n")).toThrow(PrusaProfileValidationError);
  });
});
