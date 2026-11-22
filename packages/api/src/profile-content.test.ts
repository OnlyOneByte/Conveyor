import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_ORCA_DOCUMENT_BYTES, MAX_PRUSA_DOCUMENT_BYTES } from "@conveyor/shared";
import {
  ProfileContentError,
  readBundledOrcaDocuments,
  readBundledPrusaConfig,
} from "./profile-content";

async function refusal(read: Promise<unknown>) {
  try {
    await read;
  } catch (error) {
    if (error instanceof ProfileContentError)
      return { status: error.statusCode, message: error.message };
    throw error;
  }
  throw new Error("expected a ProfileContentError");
}

describe("readBundledOrcaDocuments", () => {
  test("reads the machine, process and filament documents of a bundle", async () => {
    const documents = await readBundledOrcaDocuments("/profiles/orca-klipper-pla-0.2");
    expect(Object.keys(documents)).toEqual(["machine", "process", "filament"]);
    for (const [name, text] of Object.entries(documents)) expect(JSON.parse(text).type).toBe(name);
  });

  test("a bundle without Orca documents is a 404 naming a missing one", async () => {
    const answer = await refusal(readBundledOrcaDocuments("/profiles/prusa-klipper-pla-0.2"));
    expect(answer.status).toBe(404);
    expect(answer.message).toMatch(/^bundled (machine|process|filament)\.json is unavailable$/);
  });
});

describe("readBundledPrusaConfig", () => {
  test("reads the bundle's config.ini", async () => {
    const { config } = await readBundledPrusaConfig("/profiles/prusa-klipper-pla-0.2");
    expect(config).toContain("layer_height");
  });

  test("a bundle without an .ini is a 404", async () => {
    expect(await refusal(readBundledPrusaConfig("/profiles/orca-klipper-pla-0.2"))).toEqual({
      status: 404,
      message: "bundled Prusa profile has no .ini config",
    });
  });
});

describe("bundled paths", () => {
  test.each([
    [
      "a path outside /profiles",
      "/etc/passwd",
      409,
      "profile does not reference a bundled /profiles path",
    ],
    ["a nested path", "/profiles/a/b", 409, "profile has an invalid bundled path"],
    ["a .. escape", "/profiles/..", 409, "profile has an invalid bundled path"],
    [
      "an absolute path inside /profiles",
      "/profiles//etc",
      409,
      "profile has an invalid bundled path",
    ],
    [
      "a bundle that does not exist",
      "/profiles/does-not-exist",
      404,
      "bundled profile directory is unavailable",
    ],
  ] as const)("refuses %s", async (_label, path, status, message) => {
    expect(await refusal(readBundledOrcaDocuments(path))).toEqual({ status, message });
    expect(await refusal(readBundledPrusaConfig(path))).toEqual({ status, message });
  });
});

describe("a profiles root with hostile entries", () => {
  const base = mkdtempSync(join(tmpdir(), "conveyor-api-profiles-"));
  const root = join(base, "profiles");
  const previous = process.env.CONVEYOR_PROFILES_ROOT;

  function bundle(dir: string, files: Record<string, string>) {
    mkdirSync(dir, { recursive: true });
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  }
  const orca = (extra: Record<string, string> = {}) => ({
    "machine.json": '{"type":"machine"}',
    "process.json": '{"type":"process"}',
    "filament.json": '{"type":"filament"}',
    ...extra,
  });

  beforeAll(() => {
    bundle(join(base, "outside"), { ...orca(), "config.ini": "outside = 1\n" });
    bundle(join(base, "profiles-evil"), orca());
    bundle(join(root, "orca-doc-link"), { "process.json": "{}", "filament.json": "{}" });
    symlinkSync(join(base, "outside", "machine.json"), join(root, "orca-doc-link", "machine.json"));
    symlinkSync(join(base, "outside"), join(root, "dir-link"));
    symlinkSync(join(base, "profiles-evil"), join(root, "sibling-link"));
    bundle(join(root, "prusa-link"), {});
    symlinkSync(join(base, "outside", "config.ini"), join(root, "prusa-link", "config.ini"));
    bundle(join(root, "prusa-two"), { "a.ini": "first = 1\n", "config.ini": "chosen = 1\n" });
    bundle(
      join(root, "orca-big"),
      orca({ "machine.json": "x".repeat(MAX_ORCA_DOCUMENT_BYTES + 1) }),
    );
    bundle(join(root, "prusa-big"), { "config.ini": "x".repeat(MAX_PRUSA_DOCUMENT_BYTES + 1) });
    process.env.CONVEYOR_PROFILES_ROOT = root;
  });

  afterAll(() => {
    if (previous === undefined) delete process.env.CONVEYOR_PROFILES_ROOT;
    else process.env.CONVEYOR_PROFILES_ROOT = previous;
    rmSync(base, { recursive: true, force: true });
  });

  test.each([
    ["outside the root", "/profiles/dir-link"],
    ["into a sibling that shares the root's prefix", "/profiles/sibling-link"],
  ])("refuses a bundle directory symlinked %s", async (_label, path) => {
    const escaped = {
      status: 409,
      message: "profile path escapes the bundled profile root",
    } as const;
    expect(await refusal(readBundledOrcaDocuments(path))).toEqual(escaped);
    expect(await refusal(readBundledPrusaConfig(path))).toEqual(escaped);
  });

  test("refuses an Orca document symlinked outside the root", async () => {
    expect(await refusal(readBundledOrcaDocuments("/profiles/orca-doc-link"))).toEqual({
      status: 409,
      message: "machine.json escapes the bundled profile root",
    });
  });

  test("refuses a Prusa config symlinked outside the root", async () => {
    expect(await refusal(readBundledPrusaConfig("/profiles/prusa-link"))).toEqual({
      status: 409,
      message: "Prusa config escapes the bundled profile root",
    });
  });

  test("prefers config.ini over an .ini that sorts before it", async () => {
    expect(await readBundledPrusaConfig("/profiles/prusa-two")).toEqual({ config: "chosen = 1\n" });
  });

  test("refuses documents over the size caps", async () => {
    expect(await refusal(readBundledOrcaDocuments("/profiles/orca-big"))).toEqual({
      status: 400,
      message: "machine.json exceeds the 256 KiB limit",
    });
    expect(await refusal(readBundledPrusaConfig("/profiles/prusa-big"))).toEqual({
      status: 400,
      message: "bundled config.ini exceeds the 512 KiB limit",
    });
  });
});
