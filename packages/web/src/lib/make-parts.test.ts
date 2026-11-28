import { describe, expect, test } from "bun:test";
import { loadMakeParts, MAKE_DOWN, type MakeParts } from "./make-parts";

const fetched = (): Promise<MakeParts> => import("./components/make-parts");
const offline = (): Promise<MakeParts> =>
  Promise.reject(new TypeError("Failed to fetch dynamically imported module"));

describe("Make's form chunk", () => {
  test("loads the four pieces of Make's form", async () => {
    const parts = await loadMakeParts();
    expect(Object.keys(parts ?? {}).sort()).toEqual([
      "MakeWhere",
      "PrintDock",
      "SchemaForm",
      "UploadDrop",
    ]);
  });

  test("a failed download gives null, so Make can say so instead of hanging", async () => {
    expect(await loadMakeParts(offline)).toBeNull();
  });

  test("a try after a failure loads it once the download works", async () => {
    let tries = 0;
    const flaky = () => (++tries === 1 ? offline() : fetched());
    expect(await loadMakeParts(flaky)).toBeNull();
    expect(await loadMakeParts(flaky)).not.toBeNull();
    expect(tries).toBe(2);
  });

  test("the note it falls back on says what to do", () => {
    expect(MAKE_DOWN).toBe(
      "Make's form didn't load. Check your connection and try again, or reload the page.",
    );
  });
});
