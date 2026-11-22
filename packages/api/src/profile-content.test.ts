import { describe, expect, test } from "bun:test";
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
    for (const text of Object.values(documents)) expect(JSON.parse(text)).toBeObject();
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
