import { describe, expect, test } from "bun:test";
import type { CatalogPrinter } from "./api";
import { blankDraft, clearSecretsPayload, draftErrors, draftOf, printerPayload, slugOf } from "./printer-form";

const printer: CatalogPrinter = {
  id: "voron",
  transportId: "moonraker",
  name: "Voron 2.4",
  address: "10.0.0.5",
  hasSecrets: true,
  allowedGenerators: ["gridfinity"],
};

describe("printer form", () => {
  test("an empty draft names every missing field", () => {
    expect(draftErrors(blankDraft(), [], true)).toEqual({
      name: "Give the printer a name.",
      id: "Give the printer an ID.",
      transportId: "Choose the printer's software.",
      address: "Enter the printer's address.",
    });
  });

  test("a new ID must be unused and have no spaces or slashes", () => {
    const draft = { ...blankDraft("moonraker"), name: "Voron", address: "10.0.0.5" };
    expect(draftErrors({ ...draft, id: "voron" }, ["voron"], true)).toEqual({ id: "Another printer already uses voron." });
    expect(draftErrors({ ...draft, id: "a/b" }, [], true).id).toBe("Use letters, numbers and dashes, with no spaces or slashes.");
    expect(draftErrors({ ...draft, id: "voron", address: "10.0.0.5 :80" }, [], true)).toEqual({ address: "An address can't contain spaces." });
    expect(draftErrors({ ...draft, id: "voron-2" }, ["voron"], true)).toEqual({});
  });

  test("editing never checks the ID, which can't change", () => {
    expect(draftErrors(draftOf(printer), ["voron"], false)).toEqual({});
  });

  test("an ID is suggested from the name", () => {
    expect(slugOf("  Voron 2.4 (garage) ")).toBe("voron-2-4-garage");
    expect(slugOf("Élégoo Centauri")).toBe("elegoo-centauri");
  });

  test("a draft round-trips a printer and saves trimmed fields, a typed secret and the allowlist", () => {
    const draft = draftOf(printer);
    expect(draft).toEqual({ id: "voron", name: "Voron 2.4", transportId: "moonraker", address: "10.0.0.5", secret: "", restrict: true, allowed: ["gridfinity"] });
    expect(printerPayload({ ...draft, name: " Voron ", secret: " k " })).toEqual({
      id: "voron",
      name: "Voron",
      transportId: "moonraker",
      address: "10.0.0.5",
      secrets: { apiKey: "k" },
      allowedGenerators: ["gridfinity"],
    });
    expect(printerPayload({ ...draft, restrict: false })).not.toHaveProperty("allowedGenerators");
    expect(printerPayload(draft)).not.toHaveProperty("secrets");
  });

  test("clearing secrets resends the saved printer with secrets: null and nothing from the form", () => {
    expect(clearSecretsPayload(printer)).toEqual({
      id: "voron",
      name: "Voron 2.4",
      transportId: "moonraker",
      address: "10.0.0.5",
      secrets: null,
      allowedGenerators: ["gridfinity"],
    });
    expect(clearSecretsPayload({ ...printer, allowedGenerators: undefined })).not.toHaveProperty("allowedGenerators");
  });
});
