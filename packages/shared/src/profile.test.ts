import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isBundledProfilePath,
  OrcaProfileValidationError,
  PrusaProfileValidationError,
  validateOrcaProfileDocuments,
  validatePrusaProfileContent,
} from "./profile";

const validate = (config: string) => () => validatePrusaProfileContent({ config });

describe("validatePrusaProfileContent", () => {
  test("accepts tab, LF and CRLF", () => {
    expect(validate("layer_height = 0.2\r\nfill_density\t= 15%\n")).not.toThrow();
  });

  test.each(["\x00", "\x08", "\x0b", "\x0c", "\x0e", "\x1f"])("rejects control char %p", (c) => {
    expect(validate(`layer_height = 0.2${c}\n`)).toThrow(PrusaProfileValidationError);
  });

  test("allows DEL and non-ASCII", () => {
    expect(validate("notes = café\x7f\n")).not.toThrow();
  });

  test("requires at least one key = value line", () => {
    expect(validate("# only a comment\n[section]\n")).toThrow(PrusaProfileValidationError);
  });
});

describe("validatePrusaProfileContent key allowlist", () => {
  test.each([
    "post_process",
    "output_filename_format",
    "print_host",
    "printhost_apikey",
    "printhost_password",
    "bed_custom_model",
    "not_a_real_setting",
  ])("rejects %p", (key) => {
    expect(validate(`layer_height = 0.2\n${key} = x\n`)).toThrow(PrusaProfileValidationError);
  });

  test("rejects a key padded with whitespace", () => {
    expect(validate("layer_height = 0.2\n  post_process   = x\n")).toThrow(
      PrusaProfileValidationError,
    );
  });

  test("rejects a line that is not an assignment", () => {
    expect(validate("layer_height = 0.2\npost_process\n")).toThrow(PrusaProfileValidationError);
  });

  test("accepts comments and section headers", () => {
    expect(validate("; note\n# note\n[print:x]\nlayer_height = 0.2\n")).not.toThrow();
  });
});

const orcaDocuments = (process: Record<string, unknown>) => ({
  machine: JSON.stringify({ type: "machine", printer_model: "x" }),
  process: JSON.stringify({ type: "process", ...process }),
  filament: JSON.stringify({ type: "filament" }),
});

describe("validateOrcaProfileDocuments key allowlist", () => {
  test.each([
    "post_process",
    "filename_format",
    "plugins",
    "slicing_pipeline_plugin",
    "print_host",
    "printhost_apikey",
    "not_a_real_setting",
  ])("rejects %p", (key) => {
    expect(() => validateOrcaProfileDocuments(orcaDocuments({ [key]: ["x"] }))).toThrow(
      OrcaProfileValidationError,
    );
  });

  test("rejects a key spelled with a JSON escape", () => {
    const documents = {
      ...orcaDocuments({}),
      process: '{"type":"process","post\\u005fprocess":["x"]}',
    };
    expect(() => validateOrcaProfileDocuments(documents)).toThrow(OrcaProfileValidationError);
  });

  test("rejects __proto__", () => {
    const documents = { ...orcaDocuments({}), process: '{"type":"process","__proto__":{}}' };
    expect(() => validateOrcaProfileDocuments(documents)).toThrow(OrcaProfileValidationError);
  });

  test("accepts ordinary settings", () => {
    expect(() =>
      validateOrcaProfileDocuments(orcaDocuments({ layer_height: "0.2", name: "p" })),
    ).not.toThrow();
  });
});

describe("bundled profiles", () => {
  const root = join(import.meta.dir, "..", "..", "..", "profiles");

  test.each(readdirSync(root).filter((d) => d.startsWith("prusa-")))("%s passes", (dir) => {
    expect(validate(readFileSync(join(root, dir, "config.ini"), "utf8"))).not.toThrow();
  });

  test.each(readdirSync(root).filter((d) => d.startsWith("orca-")))("%s passes", (dir) => {
    const read = (name: string) => readFileSync(join(root, dir, `${name}.json`), "utf8");
    expect(() =>
      validateOrcaProfileDocuments({
        machine: read("machine"),
        process: read("process"),
        filament: read("filament"),
      }),
    ).not.toThrow();
  });
});

describe("isBundledProfilePath", () => {
  test.each(["/profiles/orca-klipper-pla-0.2", "/profiles/prusa_x"])("accepts %p", (path) => {
    expect(isBundledProfilePath(path)).toBe(true);
  });

  test.each([
    "/profiles/..",
    "/profiles/../etc",
    "/profiles/a/../../etc",
    "/profiles/a..b",
    "/profiles/.hidden",
    "/profiles/",
    "/profiles",
    "/profiles/a/b",
    "/profiles/a/",
    "/profiles/%2e%2e",
    "/profiles/a\\b",
    "/profiles/a\0",
    "profiles/a",
    "/etc/passwd",
    "/data/profiles/a",
    "",
  ])("rejects %p", (path) => {
    expect(isBundledProfilePath(path)).toBe(false);
  });
});
