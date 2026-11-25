import { describe, expect, test } from "bun:test";
import type { CatalogProfile } from "./api.js";
import {
  folderOf,
  profileErrors,
  profileFacts,
  profilePayload,
  profileTag,
} from "./profile-facts.js";

const slicers = [
  { id: "orca", name: "OrcaSlicer" },
  { id: "prusa", name: "PrusaSlicer" },
];
const orca: CatalogProfile = {
  id: "orca/klipper-pla-0.2",
  slicerId: "orca",
  name: "Klipper PLA 0.2mm (Orca)",
  path: "/profiles/orca-klipper-pla-0.2",
  gcodeFlavor: "klipper",
  bundled: true,
};

describe("profileFacts", () => {
  test("reads material and layer height from the name, then firmware and slicer", () => {
    expect(profileFacts(orca, slicers)).toBe("PLA · 0.20 mm · Klipper · OrcaSlicer");
    const nylon = { ...orca, name: "Fast nylon 0.25 mm", slicerId: "prusa", gcodeFlavor: "marlin" };
    expect(profileFacts(nylon, slicers)).toBe("Nylon · 0.25 mm · Marlin · PrusaSlicer");
  });

  test("leaves out what the name doesn't say and keeps unknown ids", () => {
    expect(
      profileFacts({ ...orca, name: "Draft", slicerId: "cura", gcodeFlavor: "smoothie" }, slicers),
    ).toBe("smoothie · cura");
  });
});

describe("profileTag", () => {
  test("says where the profile came from and whether it was edited", () => {
    expect(
      [orca, { ...orca, hasEditableContent: true }, { ...orca, bundled: false }].map(profileTag),
    ).toEqual(["Bundled", "Bundled, edited", "Added"]);
  });
});

describe("profile form", () => {
  const draft = {
    name: " Voron PETG 0.25mm ",
    slicerId: "orca",
    gcodeFlavor: "klipper",
    path: folderOf("Voron PETG 0.25mm"),
  };

  test("builds the id from the slicer and the name, and trims", () => {
    expect(profilePayload(draft)).toEqual({
      id: "orca/voron-petg-0-25mm",
      name: "Voron PETG 0.25mm",
      slicerId: "orca",
      gcodeFlavor: "klipper",
      path: "/profiles/voron-petg-0-25mm",
    });
    expect(profileErrors(draft, [])).toEqual({});
  });

  test("asks for a name, a free id and a folder under /profiles", () => {
    expect(profileErrors({ ...draft, name: " - ", path: "/etc/x" }, [])).toEqual({
      name: "Give the profile a name.",
      path: "Use a folder under /profiles, like /profiles/voron-petg.",
    });
    expect(profileErrors(draft, ["orca/voron-petg-0-25mm"]).name).toBe(
      "Another profile already has this name.",
    );
  });
});
