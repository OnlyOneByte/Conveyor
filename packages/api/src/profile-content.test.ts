import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { readBundledOrcaDocuments } from "./profile-content.js";

const bundled = fileURLToPath(new URL("../../../profiles/orca-klipper-pla-0.2", import.meta.url));

describe("readBundledOrcaDocuments", () => {
  test("reads the machine, process and filament documents of a bundled profile", async () => {
    const documents = await readBundledOrcaDocuments("/profiles/orca-klipper-pla-0.2");
    expect(documents).toEqual({
      machine: await readFile(`${bundled}/machine.json`, "utf8"),
      process: await readFile(`${bundled}/process.json`, "utf8"),
      filament: await readFile(`${bundled}/filament.json`, "utf8"),
    });
  });

  test("a path outside /profiles is refused with 409", async () => {
    await expect(readBundledOrcaDocuments("/etc/orca")).rejects.toMatchObject({
      message: "profile does not reference a bundled /profiles path",
      statusCode: 409,
    });
  });

  test("a bundled path with no directory behind it is a 404", async () => {
    await expect(readBundledOrcaDocuments("/profiles/missing-profile")).rejects.toMatchObject({
      message: "bundled profile directory is unavailable",
      statusCode: 404,
    });
  });
});
