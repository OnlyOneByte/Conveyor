import { describe, expect, test } from "bun:test";
import { get } from "svelte/store";
import { announce, announcements } from "./announce.js";

describe("announce", () => {
  test("writes the message to the region for its politeness, polite by default", async () => {
    await announce("Bin 1×1 moved to Send on Voron 2.4.");
    await announce("Bin 1×1 failed.", "assertive");
    expect(get(announcements.polite)).toBe("Bin 1×1 moved to Send on Voron 2.4.");
    expect(get(announcements.assertive)).toBe("Bin 1×1 failed.");
  });

  test("clears the region first, so the same message is announced again", async () => {
    const seen: string[] = [];
    const stop = announcements.polite.subscribe((v) => seen.push(v));
    await announce("Printed.");
    await announce("Printed.");
    stop();
    expect(seen.slice(-4)).toEqual(["", "Printed.", "", "Printed."]);
  });
});
